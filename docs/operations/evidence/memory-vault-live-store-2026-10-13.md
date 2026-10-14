# Memory vault live store check — 2026-10-13

`ArtifactsVaultGitStore` from this branch, bundled unchanged into a throwaway Worker (`briar-artifacts-probe`, namespace `briar-probe`, account 459bc0fc…) and run against real Artifacts. Run 1 found that `repo.remote` is an RPC property, not a string (every git call failed with `Cannot parse remote URL: "[object JsRpcProperty]"`); the store now reads it from `repo.info()`. Run 3 (below) is after the fix, with a forget commit before the purge rewrite. Times are wall-clock ms inside the Worker.

```json
{"name":"createRepo","ok":true,"ms":3683}
{"name":"createRepo-again","ok":true,"ms":92}
{"name":"repoExists","ok":true,"ms":112,"r":true}
{"name":"head-empty","ok":true,"ms":1012,"r":null}
{"name":"snapshot-empty","ok":true,"ms":916,"r":{"commit":null,"n":0}}
{"name":"write-1","ok":true,"ms":1568,"r":{"kind":"committed","commit":"37ccee2061acbdf7376cdaa89d5fea199044d27d","value":null}}
{"name":"write-2","ok":true,"ms":1945,"r":{"kind":"committed","commit":"44964e9c86fdf16be45f634f0162c8666bb6dd27","value":"37ccee2061acbdf7376cdaa89d5fea199044d27d"}}
{"name":"concurrent","ok":true,"ms":2606,"r":["committed","conflict"]}
{"name":"head","ok":true,"ms":447,"r":"85b622bc591987ee85bc965ea7dcfd59525c26e4"}
{"name":"readFile-head","ok":true,"ms":163,"r":"A v2\n"}
{"name":"readFile-w1","ok":true,"ms":160,"r":"A v1\n"}
{"name":"readFile-missing-path","ok":true,"ms":155,"r":null}
{"name":"readFile-bad-commit","ok":true,"ms":148,"r":null}
{"name":"snapshot-head","ok":true,"ms":1065,"r":{"commit":"85b622bc591987ee85bc965ea7dcfd59525c26e4","files":["README.md","knowledge/facts/a.md","knowledge/facts/forget.md","timeline/daily/2026-10-13.md"]}}
{"name":"snapshot-old","ok":true,"ms":2176,"r":{"commit":"37ccee2061acbdf7376cdaa89d5fea199044d27d","files":{"README.md":"# readme\n","knowledge/facts/a.md":"A v1\n"}}}
{"name":"history","ok":true,"ms":1149,"r":["x\n","w2\n","w1\n"]}
{"name":"history-stopAt","ok":true,"ms":1190,"r":["x\n","w2\n"]}
{"name":"skip","ok":true,"ms":1248,"r":{"kind":"skipped","head":"85b622bc591987ee85bc965ea7dcfd59525c26e4","value":1}}
{"name":"forget-commit","ok":true,"ms":1566,"r":{"kind":"committed","commit":"40c841fabf9eb6a6995afc205db6c0d38ede847f","value":null}}
{"name":"rewrite","ok":true,"ms":6028,"r":{"sourceHead":"40c841fabf9eb6a6995afc205db6c0d38ede847f","sourceHeadTree":"dd6d469ddfb6e81203724327eaab569e66007a03","head":"d4e5bfc8b9e01f4b8a21a617fb1d9011d319cd0b","headTree":"dd6d469ddfb6e81203724327eaab569e66007a03","mapping":{"37ccee2061acbdf7376cdaa89d5fea199044d27d":"37ccee2061acbdf7376cdaa89d5fea199044d27d","44964e9c86fdf16be45f634f0162c8666bb6dd27":"a13fcb7d4aca180e6770610fef3b8a532b04c89c","85b622bc591987ee85bc965ea7dcfd59525c26e4":"d4e5bfc8b9e01f4b8a21a617fb1d9011d319cd0b","40c841fabf9eb6a6995afc205db6c0d38ede847f":"d4e5bfc8b9e01f4b8a21a617fb1d9011d319cd0b"}}}
{"name":"headTree-src-vs-target","ok":true,"ms":1911,"r":["dd6d469ddfb6e81203724327eaab569e66007a03","dd6d469ddfb6e81203724327eaab569e66007a03"]}
{"name":"target-files","ok":true,"ms":1118,"r":["README.md","knowledge/facts/a.md","timeline/daily/2026-10-13.md"]}
{"name":"target-history-has-forget","ok":true,"ms":1559,"r":[["x\n",null],["w2\n",null],["w1\n",null]]}
{"name":"deleteRepo-src","ok":true,"ms":2244,"r":true}
{"name":"repoExists-src","ok":true,"ms":71,"r":false}
{"name":"orphan-read-old-src-commit","ok":false,"ms":74,"error":"VaultRepoNotFoundError: Memory repository mv-live-8a3102b9 does not exist"}
{"name":"listRepos","ok":true,"ms":589,"r":["mv-live-8a3102b9-g2"]}
{"name":"deleteRepo-target","ok":true,"ms":1712,"r":true}
```
