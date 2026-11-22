"""Markdown → styled HTML → PDF (via Chromium). Usage: md2pdf.py in.md out.pdf "Title" REF [sign]"""
import html, subprocess, sys, os, tempfile

src, out, title, ref = sys.argv[1:5]
flags = sys.argv[5:]
sign = 'sign' in flags
noid = 'noid' in flags
body = subprocess.run(['pandoc', '-f', 'gfm', '-t', 'html5', src], capture_output=True, text=True, check=True).stdout

ident = [
    ('Document Title', title), ('Reference Number', ref), ('Version', '1.0'),
    ('Organisation Name', 'ACISI Healthcare, business name registration BN-L3SMWLDM'),
    ('System', 'ACISI clinic management system'),
    ('Prepared By', 'Megan Irungu, Founder and Data Protection Officer'),
    ('Preparation Date', '22 November 2026'), ('Review Date', '22 November 2027'),
]
id_rows = ''.join(f'<tr><th>{html.escape(k)}</th><td>{html.escape(v)}</td></tr>' for k, v in ident)

def box(head, role, name, desig):
    return (f'<td><div class="bh">{head}</div><div class="br">{role}</div>'
            f'<p><b>Name:</b> {name}</p><p><b>Designation:</b> {desig}</p>'
            f'<p><b>Date:</b> ____________________</p><p><b>Signature:</b> ____________________</p></td>')
sig = ''
if sign:
    sig = ('<h2>Authorisation and sign-off</h2><table class="sig"><tr>'
           + box('PREPARED BY', 'Document Author', 'Megan Irungu', 'Founder and Data Protection Officer')
           + box('APPROVED BY', 'Chief Information Security Officer', 'Megan Irungu', 'Founder, acting Chief Information Security Officer')
           + '</tr><tr>'
           + box('AUTHORISED BY', 'Head of Organisation', 'Megan Irungu', 'Founder and head of ACISI Healthcare')
           + '<td></td></tr></table>')

css = """
@page { size: A4; margin: 18mm 16mm 18mm 16mm; }
body { font-family: 'Liberation Serif', 'Times New Roman', serif; font-size: 10.5pt; color: #111; line-height: 1.4; }
.cover { display: flex; margin-bottom: 14px; }
.cover .l { background: #0f1b2d; color: #fff; width: 32%; padding: 18px; font: bold 22pt Arial, sans-serif; text-align: center; }
.cover .l small { display: block; font-size: 7.5pt; letter-spacing: 1px; color: #7fb8e6; margin-top: 4px; }
.cover .r { background: #1592d4; color: #fff; flex: 1; padding: 14px 18px; font-family: Arial, sans-serif; }
.cover .r .p { font-size: 8pt; font-weight: bold; color: #0f1b2d; }
.cover .r .t { font-size: 17pt; font-weight: bold; margin: 4px 0; }
.cover .r .ref { font-size: 8pt; }
h1 { display: none; }
h2 { background: #0f1b2d; color: #fff; font: bold 10.5pt Arial, sans-serif; padding: 4px 8px; margin: 18px 0 8px; text-transform: uppercase; page-break-after: avoid; }
h3 { font: bold 10.5pt Arial, sans-serif; color: #0f1b2d; border-bottom: 1.5px solid #1592d4; padding-bottom: 2px; margin: 14px 0 6px; page-break-after: avoid; }
table { border-collapse: collapse; width: 100%; margin: 6px 0 10px; font-size: 9.5pt; page-break-inside: auto; }
tr { page-break-inside: avoid; }
th, td { border: 1px solid #9aa3ad; padding: 4px 6px; vertical-align: top; text-align: left; }
thead th { background: #0f1b2d; color: #fff; font-family: Arial, sans-serif; font-size: 9pt; }
table.id th { width: 34%; background: #eef1f5; }
table.sig td { width: 50%; height: 120px; }
.bh { font: bold 9pt Arial, sans-serif; color: #0f1b2d; }
.br { font-size: 8.5pt; font-style: italic; color: #555; margin-bottom: 6px; }
table.sig p { margin: 3px 0; }
ul, ol { margin: 4px 0 8px; padding-left: 20px; }
li { margin: 2px 0; }
p { margin: 5px 0; }
a { color: #0f1b2d; }
"""
doc = f"""<!doctype html><html><head><meta charset="utf-8"><title>{html.escape(title)}</title><style>{css}</style></head><body>
<div class="cover"><div class="l">DHA<small>CERTIFICATION</small></div>
<div class="r"><div class="p">DHA CERTIFICATION — SUPPORTING DOCUMENT</div><div class="t">{html.escape(title.upper())}</div><div class="ref">Reference: {html.escape(ref)}</div></div></div>
{'' if noid else '<h2>0. Document identification</h2><table class="id">' + id_rows + '</table>'}
{body}{sig}</body></html>"""
fd, tmp = tempfile.mkstemp(suffix='.html'); os.write(fd, doc.encode()); os.close(fd)
footer = f'<div style="font-size:7.5pt;width:100%;margin:0 16mm;color:#555;display:flex;justify-content:space-between;font-family:Arial"><span><b>ACISI Healthcare</b> | {html.escape(title)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>'
js = f"""const {{chromium}}=require('playwright');(async()=>{{const b=await chromium.launch();const p=await b.newPage();
await p.goto('file://{tmp}');await p.pdf({{path:{out!r},format:'A4',printBackground:true,displayHeaderFooter:true,headerTemplate:'<div></div>',
footerTemplate:{footer!r},margin:{{top:'16mm',bottom:'18mm',left:'16mm',right:'16mm'}}}});await b.close();}})();"""
subprocess.run(['node', '-e', js], check=True)
os.remove(tmp)
print('ok', out)
