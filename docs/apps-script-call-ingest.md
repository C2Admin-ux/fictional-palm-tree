# Gmail → C2Admin call-notes ingest (Google Apps Script)

Gemini meeting notes arrive as emails from `gemini-notes@google.com` in Nick's
Gmail. This Apps Script runs **inside his Google account**, polls Gmail hourly,
and POSTs each new notes email to the app's direct-ingest endpoint
(`POST /api/calls/ingest`), which creates a draft call and runs extraction.
No Resend inbox, receiving address, or mail forwarding involved.

- Processed messages get the Gmail label **`c2-ingested`** (created
  automatically) so they are never sent twice. The app also dedupes
  server-side on the Gmail message id, so re-runs are harmless.
- The script sends nothing by email and uses no MailApp quota — it only
  reads Gmail, applies a label, and makes one HTTPS call per new message.

## Setup (one time, ~5 minutes)

1. Go to [script.google.com](https://script.google.com) while signed in to the
   Gmail account that receives the Gemini notes → **New project**. Name it
   something like `C2Admin call ingest`.
2. Replace the contents of `Code.gs` with the script below.
3. **Project Settings (gear icon) → Script Properties → Add script property**,
   twice:
   - `ENDPOINT_URL` = `https://fictional-palm-tree-ebon.vercel.app/api/calls/ingest`
   - `TOKEN` = the app's `CRON_SECRET` — the same value stored in the Vercel
     project's environment variables (Vercel → project → Settings →
     Environment Variables). It is a shared secret; don't paste it anywhere
     else.
4. **Triggers (clock icon) → Add Trigger**: function `main`, event source
   **Time-driven**, type **Hour timer**, **Every hour** → Save.
5. Google will ask for authorization the first time (Gmail read/label +
   external requests). Review and allow — the script only runs in this
   account.

## Test it

1. In the editor, select the `main` function and press **Run** once.
2. Check the **Execution log** — each new Gemini email logs `Ingested ...`
   (or `Skipping already-labeled thread`).
3. Open the app → **/calls** — each email should appear as a draft call with
   items extracted, ready for review.
4. In Gmail, the processed messages now carry the `c2-ingested` label.
   Run `main` again: nothing new is posted (and even if the label were
   removed, the server answers `duplicate: true` instead of creating a
   second draft).

## The script (paste-ready)

```javascript
// C2Admin call-notes ingest.
// Polls Gmail for Gemini meeting-notes emails and POSTs each new one to
// the app's /api/calls/ingest endpoint. Configuration lives in Script
// Properties (ENDPOINT_URL, TOKEN) — nothing sensitive is hardcoded.
//
// Sends no email (no MailApp usage); per-message failures are logged
// and retried on the next hourly run because the label is only applied
// after a successful post.

var LABEL_NAME = 'c2-ingested';
var SEARCH_QUERY = 'from:gemini-notes@google.com newer_than:2d';

function main() {
  var props = PropertiesService.getScriptProperties();
  var endpoint = props.getProperty('ENDPOINT_URL');
  var token = props.getProperty('TOKEN');
  if (!endpoint || !token) {
    throw new Error('Set ENDPOINT_URL and TOKEN in Project Settings > Script Properties first.');
  }

  var label = GmailApp.getUserLabelByName(LABEL_NAME) || GmailApp.createLabel(LABEL_NAME);
  var threads = GmailApp.search(SEARCH_QUERY);

  threads.forEach(function (thread) {
    try {
      // Labels are per-thread in Gmail; Gemini notes are one message per
      // thread, so a labeled thread is a fully-ingested one.
      var alreadyIngested = thread.getLabels().some(function (l) {
        return l.getName() === LABEL_NAME;
      });
      if (alreadyIngested) {
        console.log('Skipping already-labeled thread: ' + thread.getFirstMessageSubject());
        return;
      }

      var allOk = true;
      thread.getMessages().forEach(function (msg) {
        try {
          if (!postMessage_(endpoint, token, msg)) allOk = false;
        } catch (err) {
          allOk = false;
          console.error('Error posting message ' + msg.getId() + ': ' + err);
        }
      });

      // Label only when every message landed (success or server-side
      // duplicate) so failures are retried on the next hourly run.
      if (allOk) thread.addLabel(label);
    } catch (err) {
      console.error('Error processing thread: ' + err);
    }
  });
}

function postMessage_(endpoint, token, msg) {
  var payload = {
    token: token,
    external_id: 'gmail:' + msg.getId(),
    subject: msg.getSubject() || '',
    body: msg.getPlainBody() || '',
    received_at: msg.getDate().toISOString(),
  };

  var res = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true, // never throw on HTTP errors — log and retry next run
  });

  var code = res.getResponseCode();
  if (code >= 200 && code < 300) {
    console.log('Ingested ' + msg.getId() + ' (' + msg.getSubject() + '): ' + res.getContentText());
    return true;
  }
  console.error('Ingest failed (HTTP ' + code + ') for ' + msg.getId() + ': ' +
    res.getContentText().slice(0, 300));
  return false;
}
```

## Endpoint contract (for reference)

`POST /api/calls/ingest` with JSON body:

| Field         | Required | Meaning                                                        |
| ------------- | -------- | -------------------------------------------------------------- |
| `token`       | yes      | Must equal the app's `CRON_SECRET` (constant-time compared).   |
| `external_id` | yes      | Dedupe key; `gmail:<messageId>` (prefix added server-side too). |
| `subject`     | yes      | Email subject — cleaned into the call title.                   |
| `body`        | yes      | Plain-text email body — becomes the transcript.                |
| `received_at` | no       | ISO date string; sets the call date (defaults to today).       |

Responses: `{ success: true, call_id, extracted }` on create,
`{ success: true, duplicate: true, call_id }` when that email was already
ingested (also counts as success for labeling), `401` on a bad/missing token,
`413` above 100KB.
