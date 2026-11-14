#!/usr/bin/env python3
"""
Builds src/assets/dha/erx-terminology-0.1.0.json from the Kenya ePrescription
FHIR Implementation Guide package (ke.fhir.eprescription 0.1.0, Digital Health
Agency, Kenya), downloaded from https://fhir.dha.go.ke/ig/erx/package.tgz.

Keeps code and display only, unmodified, for: Generic Products (medicines,
Kenya MOH / Pharmacy and Poisons Board), Route of Administration, Unit of
Measure and Additional Instruction code systems.

Usage: python3 -I scripts/buildDhaTerminology.py <extracted package dir> <out.json>
"""
import glob, json, sys

src, out = sys.argv[1], sys.argv[2]
wanted = {
    'GenericProductsCS': 'products',
    'RouteOfAdministrationCS': 'routes',
    'UnitOfMeasureCS': 'units',
    'AdditionalInstructionCS': 'instructions',
}
pkg = json.load(open(f'{src}/package.json'))
data = {
    'source': f"{pkg['name']} {pkg['version']} ({pkg.get('author')}), {pkg.get('canonical')}",
    'license': 'CC-BY-4.0 (Digital Health Agency, Kenya). Medicine terminology from the Kenya Pharmacy and Poisons Board (PPB) via Open Concept Lab is subject to separate terms.',
}
for f in sorted(glob.glob(f'{src}/*.json')):
    try:
        r = json.load(open(f))
    except Exception:
        continue
    key = wanted.get(r.get('name')) if r.get('resourceType') == 'CodeSystem' else None
    if not key:
        continue
    data[key + 'System'] = r['url']
    data[key] = [{'c': c['code'], 'd': c['display']} for c in r.get('concept', []) if c.get('code') and c.get('display')]
missing = [k for k in wanted.values() if k not in data]
if missing:
    sys.exit(f'missing code systems: {missing}')
json.dump(data, open(out, 'w'), ensure_ascii=False, separators=(',', ':'))
print({k: len(v) for k, v in data.items() if isinstance(v, list)})
