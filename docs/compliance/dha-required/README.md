# DHA required documents (22 Nov 2026)

PDFs in `pdf/`, ready to upload in the portal's Documents tab.

| PDF | Portal document type | Source |
|---|---|---|
| ACISI-Privacy-Policy.pdf | Privacy Policy (Required) | `web/src/content/privacy.md`, the published notice |
| ACISI-DPIA.pdf | Data Protection Impact Assessment (Required) | `docs/compliance/DPIA-2026-11-13.md` |
| ACISI-Information-Security-Policy.pdf | Information Security Policy (Required) | `src/information-security-policy.md` |
| ACISI-Incident-Response-Plan.pdf | Incident Response Plan (Required) | `src/incident-response-plan.md` |
| ACISI-System-User-Manual.pdf | System User Manual (Required) | `src/system-user-manual.md` |

Owner's own certificates (not produced here): Certificate of Incorporation
(or Registration, to confirm with DHA), KRA PIN, Tax Compliance, ODPC.

Rebuild a PDF: `python3 src/md2pdf.py <in.md> <out.pdf> "<Title>" <REF> [noid] [sign]`.
