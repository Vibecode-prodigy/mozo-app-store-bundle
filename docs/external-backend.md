# Optie B — eigen dashboard in de Mozo App Store

Dit is geen bridge-only app. De bundle rendert het Appèl kassa-onboardingdashboard en praat met onze eigen backend. `context.api` van de host wordt niet gebruikt voor orders/menu/tables/payments.

## Externe backends

| Backend | Origin | Wat er naartoe gaat |
| --- | --- | --- |
| Onboarding API | `https://mozo-kassa-onboarding-dashboard.lovable.app` | Sunmi-proxy, gebruikersbeheer, signed URLs, hardware-orders, uitnodigingsmail |
| Supabase | `https://akzxmvhlhhkywqoovkgi.supabase.co` | Auth, locaties/areas/apparaten/checklists, foto’s en menu’s |
| Sunmi Open API | `https://openapi.sunmi.com` | Apparaatlijst, online-status, herstart, live scherm |

## Data die de bundle verwerkt

- Account: e-mail, rol (`internal` / `partner` / `installateur`), sessie
- Vestiging: naam, adres, locatienummer, contact, installatiedata, open items
- Apparaten: POS-id, serienummer, model, koppeling aan area
- Installatie: checklistantwoorden, foto’s, opmerkingen
- Sunmi: serienummer, live device-info, actielog, remote-view URL (alleen met scope `devices:remote-control` + in-app toestemming)
- Hardware-orders: bestelgegevens naar leveranciers

Geen Mozo POS-orders, menu-items, tafels of betalingen via `context.api`.

## Subverwerkers

1. **Lovable Cloud** — hosting van de onboarding-API (`*.lovable.app`)
2. **Supabase** — database, auth, object storage
3. **Sunmi** — MDM / remote view van POS-hardware
4. **TransIP / hardware-leveranciers** — alleen bij een hardware-order vanuit de app

## Verwerkersovereenkomst

Verwerkersovereenkomst (VWO) tussen Mozo (verwerkingsverantwoordelijke voor de App Store-host) en Appèl/Mozo onboarding (verwerker van onboardingdata) moet bij de indiening worden gevoegd. Dit document is de technische bijlage daarbij, geen getekende VWO.

## Scopes

- `venue:read` — huidige vestigingsnaam uit de host
- `devices:remote-control` — live scherm van een POS-apparaat. Installatie van de app moet deze scope apart toestaan. In de UI is er een extra bevestiging per sessie. Er zit geen “scherm overnemen”-knop in de installatiechecklist.
