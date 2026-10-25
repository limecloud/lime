# Lime Computer Use Privacy Policy

Last updated: 2026-10-25

Lime Computer Use connects Chrome to the Lime application or CLI through Chrome
Native Messaging. It lets you organize task tabs and explicitly approve a tab
for observation and control.

## Data processed

While connected, the extension reports available HTTP/HTTPS tab URLs and tab
identifiers to the local Lime runtime so you can select a target. On an approved
target, requested actions can process page titles, visible content, form values,
input you ask Lime to enter, and page screenshots. Password input values are
excluded from DOM observation; screenshots and other page text may still contain
sensitive information visible on the page.

Chrome storage keeps a random local profile identifier, connection status,
task names, and tab-group metadata. Session approval is separate from creating a
tab group. Navigation or disconnection invalidates extension-side approval;
the Lime runtime also checks target-bound grants, cancellation, and leases.

## Data transmission and use

The extension sends browser information to the local Lime runtime using Native
Messaging. It contains no advertising, analytics SDK, or independent cloud
collection endpoint. Lime may send requested page content or screenshots to the
model provider configured by the user as part of the task. Provider processing is
subject to the user's Lime configuration and the selected provider's terms.
Do not approve tabs containing information you do not want included in a task.

The extension does not sell data, use it for advertising, or transfer it to data
brokers. Requested navigation and interactions communicate with the websites
involved in the task as normal browser activity.

## Permissions

- `tabs`, `activeTab`, and HTTP/HTTPS host access: discover selectable targets and
  work with user-selected regular webpages.
- `tabGroups`: create and name native task groups and group their child tabs.
- `debugger`: take page screenshots and submit approved mouse/keyboard input.
- `scripting`: observe an approved page's rendered content on demand.
- `nativeMessaging`: connect to the locally installed Lime host.
- `storage`: store local profile, task-group, and connection metadata.
- `alarms`: reconnect the MV3 worker when the local host becomes available.

No history, cookies, clipboard, notification, or account-login permission is
requested. Chrome-restricted pages are not supported.

## User controls

You can deny a tab request, revoke its grant in Lime, turn off the Chrome adapter,
disable or remove the extension, and clear its Chrome storage. Revocation stops
further authorized control; it cannot undo website changes already submitted or
data already processed by a model provider. Task groups do not grant control.

## Contact

Project and issue tracker: https://github.com/aiclientproxy/lime
