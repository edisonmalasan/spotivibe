# Attribution

## Lyrix (`aryanjsx/Lyrix`)

Spotivibe's capability scope and several implementation patterns were validated against [Lyrix](https://github.com/aryanjsx/Lyrix), an MIT-licensed reference implementation. Lyrix is studied and ported **selectively** — see `ROADMAP.md` §9 (Selective Lyrix Porting Rules), including the areas that must never be ported.

As of M0, **no Lyrix source code has been copied into this repository.** Lyrix concepts informed documentation and planning only.

### License notice to retain on derived code

If substantial Lyrix code is copied or modified into Spotivibe (rather than independently reimplemented), the applicable MIT notice must be retained:

```text
MIT License

Copyright (c) 2026 Lyrix Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Rules for Lyrix-derived code

1. Prefer independent reimplementation informed by Lyrix behavior over verbatim copying.
2. Any file containing substantial copied/modified Lyrix code must carry an MIT notice header comment (license text above or a reference to this file) and be listed in the table below.
3. Only areas listed as **KEEP** / **ADAPT** / **REFACTOR** in `ROADMAP.md` §6.1 may be ported; everything in §6.3 / §9.2 is prohibited.
4. Release validation (`ROADMAP.md` §15) checks that attribution notices exist for substantial Lyrix-derived code.

### Lyrix-derived files in this repository

| File | Derived from | Nature of derivation |
|---|---|---|
| _(none yet)_ | — | — |
