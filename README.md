# Dark Matter and Neutrino Lab website

Source of https://dark-matter.ucr.edu/ (UC Riverside). Everything runs from this repository:
GitHub updates the data every night, the web server copies the repository, and corrections are reviewed
on any computer with a clone and sent back with one command.

## How it runs

| Part | Where | What happens |
|---|---|---|
| Nightly update | GitHub Actions, `.github/workflows/nightly.yml` | Refreshes publications and GitHub details, finds new dark matter limit papers, reads their figures, commits the results. |
| Curve database | `tools/limits.sql` (text, tracked) | The source of truth. `tools/limits.db` is a local working copy rebuilt from it automatically and never committed. |
| Public curve file | `data/limits.json` | Rebuilt by `.github/workflows/publish-curves.yml` whenever `tools/limits.sql` changes. |
| Web server | a clone of this repository | Pulls every 15 minutes. It runs no Python and needs no packages. |
| Review | your laptop (a clone) | `python3 tools/limits.py serve`, review in the browser, then `python3 tools/limits.py publish`. |
| Problem reports | GitHub Issues, label `curve-correction` | Opened from the plotter's "Report a problem" button; listed on the review page. |

### Web server setup (once)
```
cd ~/htdocs/test2                 # the folder that holds the site folder
mv site site-old                  # keep the old copy until the new one works
git clone https://github.com/UCRDarkMatter/dark-matter-lab-site.git site
crontab -e                        # add the line below, and remove the old limits.py / update_site_data.py lines
*/15 * * * * cd $HOME/htdocs/test2/site && git pull -q --ff-only
```
The server must not change tracked files, or `git pull` stops; it only reads. `.htaccess` files keep
`.git/`, `.github/` and `tools/` off the web (Apache with AllowOverride; the repository is public anyway).

### Reviewing curves (on your laptop)
Step-by-step guide for reviewers, including what to keep and how to name curves: [REVIEWING.md](REVIEWING.md).

```
git clone git@github.com:UCRDarkMatter/dark-matter-lab-site.git     # with an SSH key; or the https:// address
cd dark-matter-lab-site
python3 tools/limits.py serve     # fetches the latest curves first; open http://127.0.0.1:8787/Limits.html
```
On the review page, **Publish my changes and get new curves** sends your changes to GitHub (the site follows
within ~15 minutes) and brings in curves added since you started, so you can review while a nightly run is
still going: it pushes after every batch of 10 papers. `python3 tools/limits.py publish` does the same from
the command line.
Python 3 is enough for reviewing; the figure reader (`extract`, `figures`) also needs `pip install pymupdf`.
The nightly job and your reviews both change `tools/limits.sql`. When git cannot combine the two line by line,
the script merges them record by record: your edits and new curves are kept, and so are the job's (where both
changed the same field of the same curve, the side that publishes later wins). A copy of the unmerged version is
kept in `tools/backups/unmerged-*.sql` each time.

### Running the update by hand
GitHub → Actions → **Nightly update** → **Run workflow**. Set *max_papers* (e.g. 300 for a backfill) or list
arXiv numbers in *papers* to (re)process just those. GitHub emails the repository's admins if a run fails.
The optional AI figure reading is off; to use it, add a repository secret `ANTHROPIC_API_KEY` and add `--ai` to
the `limits.py update` line in `nightly.yml`.


## Pages
`index.html`, `Publications.html`, `People.html`, `Tools.html`, `Limits.html`, `Outreach.html`, `Contact.html`.
Not rebuilt yet: `Experiments.html` and the individual experiment pages (the menu still points at the existing ones).

## Where to edit things
| What | Where |
|---|---|
| Menu, header logo, footer (all pages) | `assets/site.js`, top of the file |
| Colours and fonts, day and night | the token block at the top of `assets/style.css` |
| Lab members | `data/people.json` |
| Outreach events | `data/events.json` (they move from Upcoming to Past by date) |
| Tools list | `data/tools.json` |
| Photos and logos | put them in `images/`; the spots are marked with comments in `index.html` |

## What updates by itself
- **Publications** (and "Latest papers" on the home page): `tools/update_site_data.py` rebuilds
  `data/publications.json` from arXiv, adding citation counts, collaboration names and journal
  references from INSPIRE. Each visitor's browser also asks arXiv for the 25 newest papers.
- **Tools**: GitHub stars, language and last-update date for each repository.
- **Outreach**: upcoming/past split. **Footer**: year.
- An experiment page can show its own papers with
  `<div id="pubs" data-group="DUNE" data-compact></div>` plus `<script src="assets/publications.js"></script>`
  (groups: `DarkSide`, `DEAP-3600`, `DUNE`).

## Publications
`tools/update_site_data.py` refreshes `data/publications.json` and `data/github.json` (run nightly by GitHub).

The arXiv search is `au:Westerdale` (set in `assets/publications.js` and the updater's `--query`).
The INSPIRE search is `a Westerdale, S` (`--inspire-query`); if the citation counts look wrong, adjust it.

## Dark matter limit plotter (`Limits.html`)
`tools/limits.py` finds collaboration papers with new exclusion limits on arXiv, pulls the curves into
`tools/limits.db` (SQLite) and publishes them to `data/limits.json`, which the page plots.

Where curves come from, in order:
1. HEPData tables (currently refused by HEPData's bot check; `add-hepdata` imports tables you download yourself).
2. Data files in the arXiv source package.
3. **The figure reader** (`tools/figures.py`; needs PyMuPDF: `pip install pymupdf`, or without pip or admin
   rights `python3 tools/figures.py --install`, which unpacks it into `tools/vendor/`): reads the exact line coordinates out
   of the vector PDF figures in the source package, reads the tick labels to get the axis scales, and names
   each line from the legend. No API key. It returns every line in every mass-vs-cross-section figure, so
   each paper's candidates wait in the review page, where you keep the right ones
   ("Show all on plot", then Approve, then "Reject all remaining from this paper").
   EPS figures need Ghostscript (`gs`); image-only figures (PNG/JPEG) need the hand digitizer.
   Each curve is then sorted automatically: **own** (judged to be this paper's result, renamed like
   "LZ 2024 (4.2 t·yr)"), **quoted** (another experiment's curve or a reference line drawn for comparison:
   rejected automatically, restorable from "Rejected curves" on the review page) or left for **review**.
   On the review page, "Approve this paper's own (N) and reject the rest" settles a paper in one click.
   After updating the scripts, `python3 tools/limits.py extract --pending` re-sorts papers still awaiting review.
   `python3 tools/limits.py figures 2410.17036` shows what it finds in one paper without saving anything.
4. Optional, off by default: with `update --ai` (and `ANTHROPIC_API_KEY` set), Claude reads the PDF when
   nothing above found a curve. Approximate.

Anything from steps 3 and 4 stays "unreviewed" (hidden unless a visitor ticks "Include unreviewed curves")
until approved.

Review page (from `serve`): open problem reports, approve/reject curves, fix labels of published curves,
mark papers that have no new limit, and digitize a curve by clicking on a screenshot of the figure.

Command line: `limits.py list --search SuperCDMS`, `edit 735 --label "SuperCDMS 2024"`, `approve 12 13`, `reject 14`,
   `extract 2410.17036` (process one paper now), `doctor` (check and repair the database and the page data),
   `add 2207.03764 curve.csv --label "LZ 2022" --channel SI --y-unit zb`
   (also `--kind projection|discovery|model`, `--shape region`, `--sigma 5`).

Kinds of entry
- `limit` (solid), `projection` (dashed), `discovery` (3σ/5σ contours, shorter dashes) and `model`
  (theory predictions, drawn as filled regions or dash-dot target lines). Visitors switch each kind on or off.
- Projections and discovery contours come from the same collaboration search, plus a list of planned
  experiments (XLZD, DARWIN, DarkSide-20k, ARGO, PandaX-xT, ...). A collaboration paper is treated as a
  projection when its abstract talks about sensitivity/prospects and reports no data.
- Model predictions come from theory papers matched by the `MODELS` list at the top of `tools/limits.py`
  (supersymmetric global fits, Higgsino/wino, Higgs portal, thermal targets, freeze-in, neutrino fog, ...).
  They are almost always figure-only, so they need the AI step (or the hand digitizer) and always wait
  for review. Edit `MODELS` to add or drop model families; `--since` limits how far back it looks.
- Ultra-heavy dark matter has two plot types: `UHDM-A4` (DM-nucleon cross-section assuming σ_χA = A⁴ σ_χN)
  and `UHDM-A` (A-independent DM-nucleus cross-section). Their excluded areas are islands with an upper edge,
  so they are stored as outlines (`region`) or as open boundaries kept in drawing order (`path`), and the
  "Shade excluded region" option leaves them alone. Masses can be shown in grams as well as eV to PeV.
- Plot colours are the lab's ROOT `dscolors` list (`SERIES` at the top of `assets/limits.js`): `light` is
  used on white, `dark` on the night theme.

Safety
- Once a day, before changing anything, the script copies `tools/limits.db` and `data/limits.json` into
  `tools/backups/` (the last 21 days are kept; `.htaccess` keeps that folder off the web).
- It will not overwrite the published file with one that holds less than half as many curves
  (`export --force` overrides), and it stops if the database is missing while real curves are published.
- `python3 tools/limits.py restore tools/backups/limits-YYYY-MM-DD.db` (or `restore data/limits.json`) rebuilds
  an empty database.
- When updating the site, replace individual files; never replace the whole folder, or `tools/limits.db` goes with it.

Notes
- `data/limits.json` shipped here holds SYNTHETIC demo curves; the first `update` that finds real curves replaces it.
- `tools/.htaccess` blocks web access to `tools/` (the database and scripts) on Apache. On another web
  server, block that folder in its own configuration.
- The list of collaborations and search words is `COLLABS` at the top of `tools/limits.py`; plot types are `CHANNELS`.

## Gamma Line Explorer (beta)

`Gammas.html` runs entirely in the browser from `data/gamma/core.json` and `data/gamma/all.json`. To rebuild them:

1. Fetch fresh ENSDF data: run the **Fetch gamma data** workflow (Actions tab). It saves the IAEA LiveChart files on the `gamma-data` branch.
2. On any machine with Python 3 and `pip install --user numpy periodictable xraylib`:
   ```sh
   git fetch origin gamma-data && mkdir -p /tmp/lc && git archive origin/gamma-data | tar -x -C /tmp/lc
   git clone --depth 1 https://github.com/UCRDarkMatter/CASCADE.git /tmp/CASCADE
   python3 tools/gamma/build_gamma_data.py /tmp/lc/livechart /tmp/CASCADE/Supplemental/LevelStructureTXTs
   ```
3. Commit `data/gamma/`. Curated context (where sources appear, tests, cosmogenics by material, reactions) lives in `tools/gamma/curation.py`.
