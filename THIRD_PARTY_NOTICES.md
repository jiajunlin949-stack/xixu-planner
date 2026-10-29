# Third-party software and assets

The project license does not replace the following upstream licenses. Keep these notices when redistributing the bundled components. Files are shipped in `xixu-harmony/web/vendor` and copied into generated offline resources as needed.

| Component | Source | License / bundled notice |
| --- | --- | --- |
| Hyalite 0.5.0 | https://github.com/VII-Cae/hyalite--liquid-glass ; pinned source commit `b9f27192a7256bf5295bf027b582b86864f9b59d` | MIT; `xixu-harmony/web/HYALITE-NOTICE` |
| Lucide | https://github.com/lucide-icons/lucide | ISC and incorporated Feather MIT notices; `web/vendor/LUCIDE-LICENSE` |
| PDF.js and bundled CMaps | https://github.com/mozilla/pdf.js | Apache-2.0; `web/vendor/PDFJS-LICENSE` (see also headers in PDF.js files) |
| SheetJS Community Edition | https://github.com/SheetJS/sheetjs | Apache-2.0; `web/vendor/SHEETJS-LICENSE` |
| Nunito | https://github.com/googlefonts/nunito | SIL Open Font License 1.1; `web/vendor/NUNITO-LICENSE` |
| fflate 0.8.2 | https://github.com/101arrowz/fflate | MIT; `web/vendor/FFLATE-LICENSE`; pinned npm package integrity verified before adding its UMD bundle |

Paths beginning with `web/` in the table are relative to `xixu-harmony/`. Hyalite supplies the optical engine; Xixu supplies its application-specific integration, styling and capability guards. The presence of these components is not an endorsement by their maintainers.

The app icon is a project-supplied graphic. Do not present redistributed or modified applications as official releases by the Xixu maintainer.

The optional Python companion declares its dependencies separately. Those dependencies retain their upstream licenses; they are installed from package repositories and are not re-licensed as project-authored code. Runtime databases, model weights, credentials and exported originals are not bundled in this source repository.
