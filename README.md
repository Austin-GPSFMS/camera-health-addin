# Vehicle & Camera Health — MyGeotab Add-In (GPSFMS)

A dashboard of every Geotab-native camera (Surfsight, GO Focus / SmarterAI,
Sensata) and the GO device it is paired to, **sorted oldest offline first**,
with shared **snoozes** for spares, battery-cutoff units and trucks in the
shop. Same idea as the VisionTrack add-in's Watchdog report, but for the
cameras that live in Geotab's own Cameras view — and with no proxy, because
camera-services authenticates off the MyGeotab session.

## What it shows

| Tile | Meaning |
|---|---|
| **Issues** | Everything below, minus active snoozes. The default view. |
| **Camera issue** | Camera silent ≥ threshold, GO still reporting. A *GO active* badge means the GO talked within the last 24 h — the truck is clearly in service and the camera is the problem. |
| **GO issue** | GO silent ≥ threshold, camera still reporting — harness / install. |
| **Both silent** | Neither has reported — usually parked / powered down / battery cutoff. |
| **No GO paired** | A camera-services pairing whose GO serial is blank, unknown to this database, or belongs to an archived vehicle. |
| **No camera paired** | Active vehicle with no pairing. Counted as an issue only when the setting says so (off by default for mixed fleets). |
| **Snoozed** | Rows hidden by an active snooze. Overridden snoozes (see below) show under Issues instead. |

The *Offline* column is the larger of the camera and GO durations and is the
default sort. Every header sorts; partner chips, the group picker and search
narrow the set; **Export CSV** writes the rows currently shown.

## Snooze rule

* Rows show when the camera **or** the GO has been offline for at least the
  **offline threshold** (default **14 days**).
* **Snooze** hides a row for 7 / 14 / 30 days or a custom number of days, with
  a reason (Spare, Battery cutoff, In shop, Seasonal, Other) and a note.
  Snoozes are keyed to the vehicle, so one snooze covers both the camera and
  the GO on that truck. Orphan cameras are keyed by camera id.
* A snoozed row comes back when the snooze expires — **or sooner, once either
  device has been offline for the hard limit** (default **45 days**). A spare
  is expected to go quiet; one that has been dark six weeks is worth a look.
  A device that has *never* reported has no measurable duration, so it honours
  its snooze until expiry.
* Snoozes and settings are stored in MyGeotab `AddInData` (add-in id
  `aFSRQx5srR4q-Dd-Ptv1cZg`), so **every user on the database sees the same
  board** with who snoozed what, when and why. If the user cannot write
  AddInData the page still works read-only with browser-local settings.

## Data sources

| Side | Call | Fields used |
|---|---|---|
| Vehicles | `Get Device` (all, incl. archived) | name, serial, groups, activeTo |
| GO health | `Get DeviceStatusInfo` | `dateTime` (last communication) |
| Groups | `Get Group` | names, hierarchy for the picker |
| Store | `Get AddInData` by `addInId` | snoozes + settings |
| Cameras | `GET https://media-services.geotab.com/DeviceMappings` | `associatedDeviceSerialNumber`, `partnerId`, `deviceStatus`, `partnerDeviceLastOnlineAt`, `partnerDeviceHealthStatus`, `partnerDeviceHealthErrors` |

The four MyGeotab calls go out as one `multiCall`; camera-services is one
request. Join key is the **GO serial number**. Required camera role on the
user: `ListAssets` (403 otherwise). All threshold / filter / sort / snooze
logic runs locally on the loaded rows.

> First live run: expand **camera-services call log** at the bottom of the
> page. It shows the HTTP status, mapping count and the raw first record so
> the field names in `src/api/cameraServices.ts → normalizeMapping()` can be
> confirmed against the real response. The normaliser already accepts the
> documented `DeviceMappingResponse` names plus the obvious aliases and
> unix-ms timestamps.

## Repo layout

```
camera-health-addin/
├── src/
│   ├── main.tsx                 # MyGeotab add-in lifecycle (window.geotab.addin.vehicleCameraHealth)
│   ├── App.tsx                  # load → rows → tiles / toolbar / table / dialogs
│   ├── api/geotab.ts            # api.call wrappers, DeviceStatusInfo join, AddInData store
│   ├── api/cameraServices.ts    # GET /DeviceMappings with X-MyGeotab-* headers
│   ├── utils/health.ts          # PURE rules: diagnosis, snooze/hard-limit, filters, sort
│   ├── utils/csv.ts · demo.ts · format.ts
│   └── components/              # Summary tiles, HealthTable, SnoozeDialog, SettingsPanel, GroupFilterPicker, ErrorBoundary
├── test/run.mjs                 # offline rules tests (esbuild bundle, node assert)
├── config.json                  # add-in manifest (Activity menu)
└── vite.config.ts               # absolute GitHub Pages base
```

## Build, test, deploy

```powershell
cd C:\Users\User\Projects\camera-health-addin
npm install
npm test          # rules tests
npm run build     # tsc + vite → dist/
```

First-time repo setup (GitHub Pages serves `main`, root):

```powershell
cd C:\Users\User\Projects\camera-health-addin
git init
git add .
git commit -m "Vehicle & Camera Health add-in"
gh repo create austin-gpsfms/camera-health-addin --public --source . --push
```

Then enable Pages on the repo (Settings → Pages → Deploy from branch → `main` / root)
and paste `config.json` into **System Settings → Add-Ins → New Add-In** on each
database. The menu item lands under **Activity**. Subsequent updates: edit →
`npm run build` → commit → push → wait ~1 min → reload MyGeotab with cache
disabled. `dist/` is committed because Pages serves it.

Opening `dist/index.html` outside MyGeotab renders a **standalone preview**
with demo data (every diagnosis and snooze state represented) — useful for
styling, useless for camera-services (CORS needs the MyGeotab origin).

## Notes / known limits

* `DeviceMappings` is read in one page; if a very large tenant turns out to
  paginate, the call log will show fewer mappings than expected — add paging
  in `fetchDeviceMappings()`.
* "Site" is the first group matching `NNN - Name` (Waste Pro division style);
  other databases just get "—".
* Snoozing a row already past the hard limit is allowed but pointless — the
  dialog says so and suggests raising the limit in Settings.
* Archived vehicles never get a "No camera" row; they only appear as the
  target of an orphan pairing.
