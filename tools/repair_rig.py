#!/usr/bin/env python3
"""
Repair the rig on the Tripo generated dragon GLB, then split it for the web.

The source file is valid glTF. The official validator passes it. It is still
broken: every node is missing its translation and rotation, so the bind pose
survives only inside the inverse bind matrices, and those were written in a
Z up frame while the mesh is Y up. Loaded as is, every bone sits at the world
origin and the skinned mesh collapses the moment anything animates it.

This script rebuilds each joint's local transform from the inverse bind
matrices and rewrites the matrices to match.

Outputs, into the folder you pass as the second argument:
  robotic_dragon_rig_fixed_8k.glb   repaired model, original 8K texture
  dragon_geometry_2k.glb            geometry and skinning only, no image
  dragon_basecolor_2k.jpg           the base colour map on its own

The geometry and the image are kept apart on purpose. Three.js loads an image
embedded in a GLB by wrapping it in a blob URL and fetching it, and a hosted
page's content security policy usually refuses blob connections. The texture
then fails with nothing but a console warning, and you get a white model.

Usage:  python tools/repair_rig.py original.glb assets/
Needs:  numpy, pillow
"""
import copy
import io
import json
import os
import struct
import sys

import numpy as np
from PIL import Image

GLB_MAGIC, JSON_CHUNK, BIN_CHUNK = 0x46546C67, 0x4E4F534A, 0x004E4942
COMPONENT = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}
NUM = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_glb(path):
    raw = open(path, "rb").read()
    magic, _, length = struct.unpack("<III", raw[:12])
    assert magic == GLB_MAGIC, "not a GLB file"
    off, js, blob = 12, None, None
    while off < length:
        clen, ctype = struct.unpack("<II", raw[off:off + 8])
        chunk = raw[off + 8:off + 8 + clen]
        if ctype == JSON_CHUNK:
            js = json.loads(chunk)
        elif ctype == BIN_CHUNK:
            blob = chunk
        off += 8 + clen
    return js, blob


def accessor(js, blob, index):
    a = js["accessors"][index]
    bv = js["bufferViews"][a["bufferView"]]
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    n = NUM[a["type"]]
    arr = np.frombuffer(blob, dtype=COMPONENT[a["componentType"]], count=a["count"] * n, offset=off)
    return arr.reshape(a["count"], n) if n > 1 else arr


def quat_from_matrix(m):
    """Rotation matrix to an x y z w quaternion."""
    t = np.trace(m)
    if t > 0:
        s = np.sqrt(t + 1) * 2
        q = [(m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s, 0.25 * s]
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = np.sqrt(1 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        q = [0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s, (m[2, 1] - m[1, 2]) / s]
    elif m[1, 1] > m[2, 2]:
        s = np.sqrt(1 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        q = [(m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s, (m[0, 2] - m[2, 0]) / s]
    else:
        s = np.sqrt(1 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        q = [(m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s, (m[1, 0] - m[0, 1]) / s]
    q = np.array(q, dtype=float)
    return q / np.linalg.norm(q)


def write_glb(js, blob, path):
    blob = bytes(blob) + b"\0" * ((-len(blob)) % 4)
    js = copy.deepcopy(js)
    js["buffers"][0]["byteLength"] = len(blob)
    head = json.dumps(js, separators=(",", ":")).encode()
    head += b" " * ((-len(head)) % 4)
    total = 12 + 8 + len(head) + 8 + len(blob)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", GLB_MAGIC, 2, total))
        f.write(struct.pack("<II", len(head), JSON_CHUNK))
        f.write(head)
        f.write(struct.pack("<II", len(blob), BIN_CHUNK))
        f.write(blob)
    return total


def repair(src, outdir):
    js, blob = read_glb(src)
    prim = js["meshes"][0]["primitives"][0]
    skin = js["skins"][0]
    joints = skin["joints"]
    nodes = js["nodes"]
    n_joints = len(joints)

    # glTF stores matrices column major, numpy wants row major
    ibm = accessor(js, blob, skin["inverseBindMatrices"]).reshape(-1, 4, 4)
    ibm = ibm.transpose(0, 2, 1).astype(np.float64)

    # The mesh is Y up and the bind matrices are Z up. This is the axis swap
    # plus the height offset that puts the two back into the same space.
    to_mesh = np.eye(4)
    to_mesh[:3, :3] = np.array([[0, 1, 0], [0, 0, 1], [1, 0, 0]], dtype=float)
    to_mesh[:3, 3] = [0, 0.5, 0]

    # World transform of every joint, with any scale or shear squeezed out
    world = np.zeros((n_joints, 4, 4))
    for i in range(n_joints):
        m = to_mesh @ np.linalg.inv(ibm[i])
        u, _, vt = np.linalg.svd(m[:3, :3])
        rot = u @ vt
        if np.linalg.det(rot) < 0:
            rot = -rot
        w = np.eye(4)
        w[:3, :3] = rot
        w[:3, 3] = m[:3, 3]
        world[i] = w

    parent = {}
    for i, node in enumerate(nodes):
        for child in node.get("children", []):
            parent[child] = i

    def parent_joint(node_index):
        p = parent.get(node_index)
        while p is not None and p not in joints:
            p = parent.get(p)
        return None if p is None else joints.index(p)

    out = copy.deepcopy(js)
    for ji, node_index in enumerate(joints):
        pj = parent_joint(node_index)
        local = world[ji] if pj is None else np.linalg.inv(world[pj]) @ world[ji]
        out["nodes"][node_index]["translation"] = [float(x) for x in local[:3, 3]]
        out["nodes"][node_index]["rotation"] = [float(x) for x in quat_from_matrix(local[:3, :3])]

    new_ibm = np.linalg.inv(world)

    # Sanity check. Skinning at the rest pose has to reproduce the mesh exactly.
    pos = accessor(js, blob, prim["attributes"]["POSITION"]).astype(np.float64)
    jnt = accessor(js, blob, prim["attributes"]["JOINTS_0"])
    wgt = accessor(js, blob, prim["attributes"]["WEIGHTS_0"]).astype(np.float64)
    homog = np.c_[pos, np.ones(len(pos))]
    check = np.zeros((len(pos), 3))
    for k in range(4):
        m = world[jnt[:, k]] @ new_ibm[jnt[:, k]]
        check += wgt[:, k:k + 1] * np.einsum("vij,vj->vi", m, homog)[:, :3]
    print("rest pose error after repair: %.2e" % np.abs(check - pos).max())

    image_bv = js["images"][0]["bufferView"]
    tex_bv = js["bufferViews"][image_bv]
    jpeg = blob[tex_bv.get("byteOffset", 0):tex_bv.get("byteOffset", 0) + tex_bv["byteLength"]]
    rest_start = min(bv.get("byteOffset", 0) for i, bv in enumerate(js["bufferViews"]) if i != image_bv)
    rest = bytearray(blob[rest_start:])

    # patch the inverse bind matrices in place
    ibm_bv = js["bufferViews"][js["accessors"][skin["inverseBindMatrices"]]["bufferView"]]
    at = ibm_bv["byteOffset"] - rest_start
    packed = new_ibm.transpose(0, 2, 1).astype(np.float32).tobytes()
    rest[at:at + len(packed)] = packed

    # tidy up everything else the validator complained about
    out["skins"][0].pop("skeleton", None)
    out["asset"]["generator"] = "Tripo (rig transforms restored)"
    out["extensionsUsed"] = [e for e in out.get("extensionsUsed", []) if e != "KHR_materials_volume"]
    for name in ("JOINTS_0", "WEIGHTS_0"):
        out["bufferViews"][js["accessors"][prim["attributes"][name]]["bufferView"]]["target"] = 34962

    def set_bounds(index, data):
        a = out["accessors"][index]
        a["min"] = [float(x) for x in data.min(0)]
        a["max"] = [float(x) for x in data.max(0)]

    set_bounds(prim["attributes"]["POSITION"], pos)
    set_bounds(prim["attributes"]["NORMAL"], accessor(js, blob, prim["attributes"]["NORMAL"]).astype(np.float64))
    set_bounds(prim["attributes"]["TEXCOORD_0"], accessor(js, blob, prim["attributes"]["TEXCOORD_0"]).astype(np.float64))
    set_bounds(prim["attributes"]["WEIGHTS_0"], wgt)
    set_bounds(skin["inverseBindMatrices"],
               new_ibm.transpose(0, 2, 1).astype(np.float32).reshape(n_joints, 16).astype(np.float64))

    # A skinned mesh ignores its parent transforms, so leaving it parented is
    # misleading. Lift it and any parentless node up to the scene root.
    roots = [i for i in range(len(nodes)) if i not in parent and i != 0]
    roots += [i for i, n in enumerate(nodes) if "skin" in n]
    roots = sorted(set(roots))
    for i in roots:
        for n in out["nodes"]:
            if i in n.get("children", []):
                n["children"].remove(i)
    out["scenes"][0]["nodes"] = sorted(set([0] + roots))

    os.makedirs(outdir, exist_ok=True)

    def assemble(image_bytes, path, keep_image=True):
        j = copy.deepcopy(out)
        if keep_image:
            padded = image_bytes + b"\0" * ((-len(image_bytes)) % 4)
            shift = len(padded) - rest_start
            j["bufferViews"][image_bv]["byteLength"] = len(image_bytes)
            for k, bv in enumerate(j["bufferViews"]):
                if k != image_bv:
                    bv["byteOffset"] = bv.get("byteOffset", 0) + shift
            body = padded + bytes(rest)
        else:
            for k, bv in enumerate(j["bufferViews"]):
                if k != image_bv:
                    bv["byteOffset"] = bv.get("byteOffset", 0) - rest_start
            j["bufferViews"] = [bv for k, bv in enumerate(j["bufferViews"]) if k != image_bv]
            for a in j["accessors"]:
                if a["bufferView"] > image_bv:
                    a["bufferView"] -= 1
            for key in ("images", "textures", "samplers"):
                j.pop(key, None)
            j["materials"][0]["pbrMetallicRoughness"].pop("baseColorTexture", None)
            body = bytes(rest)
        size = write_glb(j, body, path)
        print("%-34s %6.2f MB" % (os.path.basename(path), size / 1e6))

    assemble(jpeg, os.path.join(outdir, "robotic_dragon_rig_fixed_8k.glb"))
    assemble(b"", os.path.join(outdir, "dragon_geometry_2k.glb"), keep_image=False)

    # 8K is far too heavy for a web page, so ship a 2K copy of the map
    small = io.BytesIO()
    Image.open(io.BytesIO(jpeg)).resize((2048, 2048), Image.LANCZOS).save(
        small, "JPEG", quality=86, optimize=True, subsampling=0)
    open(os.path.join(outdir, "dragon_basecolor_2k.jpg"), "wb").write(small.getvalue())
    print("%-34s %6.2f MB" % ("dragon_basecolor_2k.jpg", len(small.getvalue()) / 1e6))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    repair(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "assets")
