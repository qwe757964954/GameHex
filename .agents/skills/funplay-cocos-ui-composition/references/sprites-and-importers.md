# SpriteFrames, nine-slice, and importer edits

- Resolve the source image, its .meta ownership and exact SpriteFrame subasset UUID before assignment or importer edits. Texture, ImageAsset and SpriteFrame are different asset types; never fabricate a subasset UUID.
- Inspect source dimensions, rect/trim/rotation, cap insets, Sprite type, sizeMode and UITransform dimensions. Set CUSTOM sizeMode before assigning a SpriteFrame when authored dimensions must remain fixed, then read back the final size after assignment.
- For sliced borders, retain source-coordinate insets and surviving SpriteFrame identities. Check that left+right and top+bottom fit the source rect and that corners/borders remain intact at the intended sizes. Do not derive importer coordinates from a downscaled screenshot.
- Use focused importer/AssetDB operations when available. If a narrowly scoped .meta edit is necessary, preserve unrelated importer settings, UUIDs, submeta mappings and atlas references, refresh the exact source, and verify imported state. Do not recreate metadata or copy a .meta file to duplicate an asset.
- Changing atlas membership, trimming or slicing can affect animation tracks, nested prefabs and material/batching behavior. Inspect incoming references before a structural change and report unsupported identity preservation rather than rebuilding references by name.
- After import, `check_asset_ready` verifies only the imported AssetDB identity; inspect the actual SpriteFrame and saved component binding separately. Save/reopen when persistence is required and visually inspect corners at the target size.
- Group compatible materials/textures only while preserving intended render order. Editor node/component counts are not a runtime draw-call or GPU measurement.

Sources: [Sprite](https://docs.cocos.com/creator/3.8/manual/en/ui-system/components/editor/sprite.html) and [image assets](https://docs.cocos.com/creator/3.8/manual/en/asset/image.html).
