# EC2 cutover scripts

Three scripts and three config files. Every script is idempotent and prints
plain-English progress.

| File                  | Run when                                | Run as |
|-----------------------|-----------------------------------------|--------|
| `inspect.sh`          | first, on the existing EC2 box          | any user |
| `bootstrap.sh`        | once, on a clean (or wiped) EC2 box     | root |
| `deploy.sh`           | every time you want to ship a new build | root |
| `viva-api.service`    | installed by `bootstrap.sh`             | -- |
| `Caddyfile.example`   | installed by `bootstrap.sh`             | -- |
| `viva-api.env.example`| skeleton, copy to `/etc/viva-api.env`   | -- |

The full click-by-click walkthrough lives in
[`docs/ec2-cutover-runbook.md`](../../docs/ec2-cutover-runbook.md). Start
there, not here.
