# 3D Asset Brief

Decision (October 3): use **free models and models built in code**, and try both. If a free model looks better than the code version for an object, use it. A hired artist stays an option later.

## Objects needed
| Object | Used in | Look | Free source idea | Code-built version |
|---|---|---|---|---|
| **Gaming GPU** (generic, unbranded: no NVIDIA/AMD logos) | Hero, cycle start, app section | Dual or triple fan, dark shroud, a thin accent light strip, visible backplate | Sketchfab (filter: downloadable, CC0 or CC-BY), Poly Pizza, BlenderKit free | Box shroud + extruded fan blades (rotating) + emissive strip + PCB edge. Stylized but clean |
| **$HASH coin** | Cycle center, levels, favicon render | Thick coin, beveled rim, "#" mark embossed, brushed metal | Easier to build in code than to find | Cylinder with bevel, an extruded "#" (or the logo) on the face, environment-map reflections |
| **Mined coin tokens** (PRL, QTC) | Cycle | Smaller, simpler, different metal tints, no real logos (trademarks) | Code | Instanced small coins, tinted |
| **Chest / vault** | Cycle (fee pool) | Modern vault or capsule rather than a pirate chest. Glows from inside as it fills | Sketchfab or Poly Pizza low-poly safes | Rounded box + lid ring + inner emissive volume whose level rises |
| **Pedestals ×3** | Levels | Matte plinths of different heights | Code | Cylinders/boxes with soft lighting |
| **Monitor / laptop** showing the app | App section | Minimal bezel | Free low-poly monitor | Plane with the app screenshot as a texture |
| **Particles** (hashes, sparks) | Cycle | Thin glowing streaks, not confetti | Code | Instanced points/lines with additive blending |

## Rules for free models
- **License:** CC0 preferred. CC-BY is fine with credit in the site footer and in `apps/web/CREDITS.md`. Never use "editorial only" or non-commercial (NC) licenses.
- **No brand logos** on the GPU (NVIDIA, AMD, ASUS, etc.). Remove them or retexture.
- **Size budget:** under 1 MB per model after compression (Draco or meshopt via `gltf-transform`), and under ~50K triangles for the GPU (under ~15K on mobile).
- Record the source URL, author, license and any changes in `apps/web/CREDITS.md`.

## Look development
- One HDRI environment (a dark studio from Poly Haven, CC0) for reflections.
- Rim lights in the accent color. Mostly neutral materials, with accent color only on the energy parts (light strip, particles, chest glow).
- Render stills of the GPU and coin from the same scene for social posts and the logo, so everything matches.
