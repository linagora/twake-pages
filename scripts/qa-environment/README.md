# QA environment

A throw-away stack for exploratory QA and load tests: the app, Dex as its SSO
(behind the claims shim of `sso/`), a stand-in Grist and Mailpit.

```
scripts/qa-environment/build.sh   # once, and whenever the code under test changes
scripts/qa-environment/start.sh
scripts/qa-environment/stop.sh    # drops the containers and the data
```

`start.sh` prints the addresses and how to sign in from a browser or a
container. Accounts of `dex.yaml`, password `secret`: alice, bob and charlie
@acme.test (organization acme.test, alice its admin), dave@globex.test, and
erin@mail.test (B2C).

## QA_PERF_USERS: hundreds of accounts

```
QA_PERF_USERS=300 scripts/qa-environment/start.sh
```

Dex has no API to create users, so `QA_PERF_USERS=N` (default `0`: the stack is
as above) makes it know N more: `perf0001@acme.test` .. `perfNNNN@acme.test`
(zero padded to 4 digits at least), password `perf-secret`, the accounts the
load tests of the software factory (twake-hotspot) sign in with.

- `dex.yaml` and `sso/people.json` are not edited: `start.sh` runs
  `render-perf-users.sh`, which writes copies extended with the accounts into
  `.generated/` (git-ignored, removed by `stop.sh`), and the compose mounts
  those (`QA_DEX_CONFIG`, `QA_PEOPLE`).
- The password is hashed once (bcrypt, in a throw-away `httpd:2.4-alpine`
  container: docker is the only tool needed) and the hash is reused by every
  account. Rendering 1000 accounts takes about 2 seconds.
- Each account has a stable `userID` (`9e4f0000-0000-4000-8000-` and the
  number on 12 digits), which is the person's uuid, and, in the claims shim, the
  organization `acme.test` with the role `member`, as bob and charlie.
- First sign-in: the backend has no user table, it takes the person and their
  organization from the claims of every request. The first call to list the
  wikis creates the person's "Personal" wiki; they are in no other wiki until
  they create one or are invited (a perf account is not a member of the space
  "Design Sprint").

The host ports can be moved, for a stack next to another one, with
`QA_APP_PORT`, `QA_SSO_PORT`, `QA_GRIST_PORT` and `QA_MAILPIT_PORT` (the
addresses inside the network do not change), and the compose project with
`QA_PROJECT` (also for `stop.sh`).
