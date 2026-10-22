# Places Weekly Package (scheduled task scripts)

Scripts used by the Tuesday-morning scheduled task that builds the Colorado Springs (Places Management) weekly package:
vacancy & leasing PDF, delinquency and work order workbooks, and the PM call agenda (also written to `call_agendas`).

The task clones this branch (`automation/places-weekly`) and runs these files. Nothing here is imported by the app.

- `decode_mail.py` — extract attachments from a Gmail RAW message
- `weekly_parse.py`, `vreport.py` — Vacancy & Leasing Update PDF
- `build_workbooks.py` — delinquency (with week-over-week flags) and work order workbooks
- `build_agenda.py` — agenda JSON -> .docx and markdown
- `c2admin_query.sql` — open call items, flagged inspection items, past-due tasks, open capex for the three properties
