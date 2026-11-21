import sys, docx
d = docx.Document(sys.argv[1])
body = d.element.body
ti = 0; pi = 0
for child in body.iterchildren():
    tag = child.tag.split('}')[1]
    if tag == 'p':
        t = ''.join(x.text or '' for x in child.iter() if x.tag.endswith('}t'))
        if t.strip(): print(f'P{pi}: {t[:110]}')
        pi += 1
    elif tag == 'tbl':
        tbl = d.tables[ti]
        print(f'T{ti}: {len(tbl.rows)}x{len(tbl.columns)} first: ' + ' | '.join(c.text.strip()[:25] for c in tbl.rows[0].cells))
        ti += 1
