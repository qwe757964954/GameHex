# Fonts, text sizing, and requested localization

- Preserve the project's font system: system font, imported TTF/OTF, bitmap font, RichText, or a project-specific localization component. Resolve font assets and their actual component bindings; do not replace the font strategy merely to silence a warning.
- Verify fontSize, lineHeight, alignment, wrapping, contentSize, cacheMode and overflow at the intended viewport. CLAMP clips, SHRINK changes readable size and can cost CPU on dynamic text, and RESIZE_HEIGHT transfers height ownership to the label. Choose from project policy rather than applying SHRINK everywhere.
- Check CJK, punctuation, digits, icons and other required glyphs in representative strings. Include line breaks, long translations and dynamic/code-composed strings when localization is requested. A successful string assignment does not establish glyph coverage or readability.
- Bitmap-font atlas glyphs, character-cache capacity, fallback behavior and persisted font assets need separate checks. If coverage cannot be measured, report unknown rather than assuming all characters render.
- For requested localization, identify the existing locale IDs and mapping, text keys, authored labels, runtime formatting and fallback policy. Change only requested languages/scope and preserve existing services; do not install an unrelated localization package by default.
- Read back persisted font/text/localization references and representative outputs. Report covered, missing and unverified strings separately; inspecting authored labels does not prove coverage of runtime-generated text.
- Capture representative languages and aspect ratios and inspect missing glyphs, clipping, wrapping and layout growth. Native/device performance and input-method behavior require corresponding platform evidence.

Sources: [Label](https://docs.cocos.com/creator/3.8/manual/en/ui-system/components/editor/label.html) and [font assets](https://docs.cocos.com/creator/3.8/manual/en/asset/font.html).
