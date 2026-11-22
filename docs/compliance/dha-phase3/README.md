# DHA Phase 3 technical documents (22 Nov 2026)

Filled from DHA's own templates (portal "Document templates"), checked
against the code and `deploy/RUNBOOK.md`. Upload the `.docx` (or the PDF in
`pdf/`) under the matching document type in the portal.

| File | Portal document type | Status |
|---|---|---|
| ACISI-System-Architecture-Document.docx | System Architecture Diagram (Required) | Ready to sign |
| ACISI-Technical-Specifications.docx | Technical Specifications Document (Required) | Ready to sign |
| ACISI-Encryption-Implementation-Specification.docx | Encryption Implementation Specification | Ready to sign |
| ACISI-Audit-Trail-Specification.docx | Audit Trail Specification | Ready to sign |
| ACISI-Backup-and-Recovery-Policy.docx | Backup and Recovery Policy | Fill "Last Tested" dates (section 5) after `sudo acisi-restore-test` |
| ACISI-Disaster-Recovery-Plan.docx | Disaster Recovery Plan | Ready to sign |

Signature blocks: Prepared, Approved and Authorised by Megan Irungu; no "Reviewed by"

Rebuild: `build/` (python-docx; diagrams drawn as SVG and rendered with
Playwright: `python3 build/diagrams.py fig && node build/render.js fig`, then
`python3 build/doc_sad.py <templates> <out.docx> fig`, etc.).
