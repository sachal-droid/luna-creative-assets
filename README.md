# Luna Creative Assets

A creative assets dashboard with zip upload, built with Express.

## Features
- Upload a zip bundle of images via the web UI
- Grid dashboard to browse creatives
- Tag each asset with a status (Draft / Approved / Winner / Rejected)
- Inline editable names and notes
- Search and filter by status, name, run, or notes

## Run locally
~~~bash
npm install
npm start
~~~
The app listens on the port defined by the PORT environment variable (default 3000).

## Deploy on Railway
1. Create a new project on Railway and connect this GitHub repository.
2. Railway auto-detects Node.js and runs npm install then npm start.
3. (Optional) Add a persistent volume mounted at a path and set DATA_DIR to it so uploads survive redeploys.
