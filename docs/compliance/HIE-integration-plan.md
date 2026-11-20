# Connecting ACISI to DHA's Health Information Exchange (HIE)

20 Nov 2026. Source: DHA's public HIE developer docs, https://hie-docs.dha.go.ke
(read 20 Nov 2026; pages dated 28 Sep 2026). This replaces the plan to wait
for interoperability@dha.go.ke (that address bounces).

## How DHA's process works

1. **Development:** DHA issues test credentials (`client_id`, `client_secret`).
   Build and test against the development middleware.
2. **UAT demo** with the HIE integration team: **afyaconnect.dha@gmail.com**
   (also the address to ask for test credentials).
3. **DHA certification** after a passed UAT.
4. **Production credentials**, then go live.

Nothing can be sent to the HIE without step 1's credentials. A draft request
is in the owner's Gmail (to afyaconnect.dha@gmail.com).

**Open question in that email:** DHA's UAT checklist is built around SHA
claims (PHC, SHIF and ECCIF funds: eligibility, pre-authorisation, claims).
ACISI does not bill SHA. We asked whether a non-claims HMIS can do UAT on
Registries + Shared Health Record only.

## The APIs (development environment)

Base URL: `https://ilm-dev.dha.go.ke/uat-middleware/api/v1`

| Step | Call | Notes |
|---|---|---|
| Token | `POST /tenants/token` (form: `client_id`, `client_secret`) | Returns `access_token`, `expires_in`; cache until expiry |
| Facility | `GET /facilities/search?identifier=&identifier-type=fr-code` | Each clinic needs its **FR code** (e.g. `FID-47-115307-8`); also `mfl`, `registration-number` |
| Which clinic | Headers `X-Facility-Id` + `X-Facility-Id-Type: fr-code` on every call | ACISI serves many clinics, so one service-account token + these headers |
| Patient | `GET /patients?identification_number=&identification_type=National ID` | Returns the **CR ID** (Client Registry) and biodata. Types: National ID, ClientRegistry ID, Birth Notification, Birth Certificate, Alien ID, Refugee ID, Mandate Number |
| Doctor | `GET /professionals?identification_number=&identification_type=registration_number&regulator=KMPDC` | Gives the **PUID** (practitioner ID). Regulators: KMPDC, COC, NCK, PPB |
| Consent | `GET /shr/open-visits`, `POST /shr/consents` (`cr_id`, `facility_id`, `requested_by`, `visit_type` OP, `practitioner_id`) | DHA sends the patient an OTP |
| Verify | `POST /shr/consents/{consent_id}/verify` (`otp_record`, `otp`) | Returns `consent_token` + `visit_id`; refusal recorded with `consent_decision: Reject` |
| Write | `POST /shr/bundles` | FHIR `collection` Bundle with an `id`; Encounter references the visit's EpisodeOfCare; every resource references the Encounter. Accepted: Encounter, EpisodeOfCare, Observation, Condition, Procedure, Medication(Request/Dispense/Administration), Immunization, ServiceRequest, AllergyIntolerance. Asynchronous |
| Read | `GET /shr/patient-records?cr_id=&practitioner_id=&resources=` + header `X-Consent-Token` | Previous visits at other facilities |
| Close | `POST /shr/visits/{visit_id}/close` (may need a closing OTP) | Close at checkout |

Profiles seen in DHA examples: `https://nshr-uat.sha.go.ke/fhir/StructureDefinition/ke-observation`.
Security labels: `GET /shr/security-labels` (N/R confidentiality; HIV, PSY, SUD sensitivity).

## What ACISI needs to build (can start before credentials)

**Done 20 Nov 2026 (off until credentials): steps 1-8** (steps 5-8 in
`src/hie/shr*.ts`, worker `hie-shr-send`, panels on the consultation and
checkout pages). Not yet: dependant (guardian) consent for children.
Also check in DHA's development environment: whether the bundle should
include an EpisodeOfCare resource or only reference DHA's; the shape of
`/shr/open-visits` and refresh answers; closing an open visit that was
reused (ACISI has no consent id for it).

Earlier note on steps 1-4 (`src/hie/`,
console page "National HIE", patient page Client Registry lookup). To check
in DHA's development environment: the exact `identification_type` strings
(the docs show both "National ID" and "NATIONAL ID"), where the PUID and CR ID
sit in real answers, and whether the token goes in `Authorization: Bearer`.


1. **HIE client** (`src/hie/`): token caching, facility headers, error
   handling, every call logged in the audit log. Off until `HIE_ENABLED=true`
   with credentials in the server settings.
2. **Clinic FR code** in clinic settings, checked against the Facility Registry.
3. **Doctor PUID:** doctor enters their KMPDC/COC/NCK registration number once;
   ACISI looks it up and stores the PUID.
4. **Patient CR ID:** at registration (national ID or birth certificate),
   look up the Client Registry, store the CR ID, flag name/date-of-birth
   mismatches. Visits still work if the HIE is down.
5. **Consent at the visit:** front desk or doctor requests consent, patient
   reads out DHA's OTP, refusal recorded. Emergency and dependant (minor)
   variants.
6. **Send the visit** when the doctor signs: build the SHR bundle from the
   existing FHIR mappers (`src/fhir/mappers.ts`) with CR ID, FR code and
   PUID references and an EpisodeOfCare; retry queue; status shown on the visit.
7. **Read previous records** from the SHR in the doctor's view (with consent).
8. **Close the visit** at checkout.
9. Privacy Notice, DPIA and ODPC record: add DHA/HIE as a recipient.

Steps 1-8 can be built and tested against a mock now; switching on needs the
credentials, then a test run in DHA's development environment, then UAT.
