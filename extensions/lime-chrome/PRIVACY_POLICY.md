# Lime Browser Bridge Privacy Policy

Last updated: 2026-04-13

## Overview

Lime Browser Bridge is a companion Chrome extension for the Lime desktop application. Its purpose is to connect your current Chrome tabs to a Lime runtime that you configure, so Lime can read page context and perform browser actions on your behalf.

## What Data The Extension Processes

Depending on the actions you trigger in Lime, the extension may process:

- the title and URL of the active tab
- page content extracted from the current webpage
- screenshots captured from the active tab
- browser tab metadata needed to switch, group, or focus tabs
- local connection settings such as server URL, bridge key, profile key, and relay port
- recent connection status and the latest page snapshot summary stored locally for status display

## How The Data Is Used

The extension uses this data only to provide the browser bridge functionality, including:

- connecting Chrome to your Lime runtime
- reading the current page when you ask Lime to inspect it
- performing browser actions you trigger through Lime
- restoring connection status and recent bridge state locally in the extension UI

## Where Data Is Sent

The extension sends processed page data only to the Lime runtime endpoint that you configure.

- By default, Lime is typically configured to run locally, for example `ws://127.0.0.1:8999`.
- The extension does not include advertising SDKs, analytics trackers, or third-party telemetry services.
- The extension does not sell your data.

Some page integrations may issue page-related network requests required to extract or complete information from the current site context. These requests are part of the page interaction workflow triggered by the user.

## Local Storage

The extension stores limited local state in Chrome storage, including:

- connection settings
- relay enablement state
- relay port settings
- latest page info summary
- recent bridge status

This local storage is used only to keep the extension working across browser restarts and to show current status in the extension UI.

## Permissions

The extension requests the following permissions to provide its single purpose:

- `debugger`: required for DevTools Protocol based actions such as screenshots, coordinate click, raw input, and page inspection
- `tabs`, `tabGroups`, `windows`, `activeTab`: required to inspect and control the current Chrome tabs and window context
- `scripting`: required to inject scripts on demand into pages the user asks Lime to inspect or control
- `storage`: required to save local configuration and status
- `clipboardRead`: required only when the user chooses to paste exported connection settings into the extension
- `alarms`: required for MV3 keepalive and reconnect behavior
- `notifications`: required to show local relay error notifications
- `<all_urls>` host permission: required because users may ask Lime to work with arbitrary regular webpages in their current session

The extension does not operate on restricted Chrome internal pages such as `chrome://`.

## Data Sharing

The extension does not sell personal information and does not share data with advertisers or data brokers.

Data is shared only with:

- the Lime runtime endpoint configured by the user
- websites the user already visits when the requested action requires normal page loading or page-origin requests

## Your Choices

You control whether the extension is enabled and which Lime runtime it connects to.

You can:

- disable the extension
- disconnect the bridge
- remove the extension from Chrome
- clear local extension storage from Chrome extension settings

## Contact

Project repository:

- `https://github.com/aiclientproxy/lime`

If you publish this policy via GitHub, use the public repository URL for this file in the Chrome Web Store listing.
