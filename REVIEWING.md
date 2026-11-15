# Reviewing dark matter limit curves

The [limit plotter](https://dark-matter.ucr.edu/test2/site/Limits.html) collects exclusion limits,
projections, discovery contours and model predictions from arXiv papers. A script reads them out of each
paper's figures every night and names them automatically. Visitors only see a curve once a person has
checked it. That check is your job: for each paper, confirm which curves are the paper's own results, give
them clear names and the right plot type, and remove the rest.

Ask Shawn whenever a paper doesn't fit these rules. A wrong curve on the public page is worse than a
missing one.

## One-time setup

1. **GitHub account.** Make one at github.com if you don't have one, and send Shawn your username. He'll
   give you write access to `UCRDarkMatter/dark-matter-lab-site`. Accept the invitation from the email or
   from github.com/notifications.
2. **Install git and Python 3** (3.9 or newer).
   - macOS: run `git --version` in Terminal; if git is missing, it offers to install it. Get Python from
     python.org.
   - Windows: install Git for Windows and Python from python.org (tick "Add python to PATH"). Use
     "Git Bash" for the commands below.
3. **Sign git in to GitHub**, so the review page can send your work. The easiest way is the GitHub CLI
   (cli.github.com): run `gh auth login`, choose GitHub.com and HTTPS, answer **Yes** to "Authenticate Git
   with your GitHub credentials?", then pick "Login with a web browser". Git for Windows can also ask you
   to sign in the first time you push.
   If you already use an SSH key with GitHub, use the SSH address in step 4 instead:
   `git clone git@github.com:UCRDarkMatter/dark-matter-lab-site.git`. (For an existing HTTPS copy, switch it
   with `git remote set-url origin git@github.com:UCRDarkMatter/dark-matter-lab-site.git`.) If git asks for
   a username and password when you publish, this sign-in step is missing.
4. **Get the code:**
   ```
   git clone https://github.com/UCRDarkMatter/dark-matter-lab-site.git
   cd dark-matter-lab-site
   ```

Optional: `pip install pymupdf` lets you run the figure reader yourself (`tools/limits.py figures` and
`extract`). You don't need it for reviewing.

## Each session

```
cd dark-matter-lab-site
python3 tools/limits.py serve
```
Open **http://127.0.0.1:8787/Limits.html** in your browser. `serve` fetches the latest curves first. The
**Review** section at the bottom of the page appears only here, never on the public site.

When you finish, or every half hour or so, press **Publish my changes and get new curves**. It sends your
work to GitHub; the public page updates about 15 minutes later. It also brings in anything new, such as
curves from a nightly run or edits by someone else. Changes made at the same time are combined
automatically, so you can't overwrite anyone's work. Stop `serve` with Ctrl-C.

## Reviewing one paper

Under **Curves waiting for approval**, curves are grouped by paper.

1. Click **Open paper** and find the figure with the limits.
2. Click **Show all on plot**, then tick **Include unreviewed curves** at the top of the page if they don't
   appear. Compare the plot with the paper's figure: same shapes, same mass range, same cross-section
   values? Hover over a curve to read off values.
3. Decide for each curve (the rules are below).
   - If the curves marked **this paper's own result** are exactly the right ones, click **Approve this
     paper's own (N) and reject the rest**. That settles the whole paper in one click.
   - Otherwise fix each curve's fields, then click **Approve** or **Reject** on it, and finish with
     **Reject all remaining from this paper**.

Curves quoted from other experiments are rejected automatically. You'll find them under **Rejected
curves**, where **Restore to the review list** brings one back if the script got it wrong.

### What to keep

| Keep (approve) | Reject |
|---|---|
| The paper's own new **observed limit** | Curves from other experiments or earlier papers (their own paper supplies them) |
| Its **projected sensitivity**, if the paper is about a future experiment or run | Median *expected* limits and ±1σ/±2σ bands of a result paper |
| Its **3σ / 5σ discovery** contours | Neutrino fog, theory lines and reference curves drawn for comparison |
| A theory paper's own **predicted region** (kind "Model prediction") | Duplicates of the same curve, e.g. from a supplementary figure |

When unsure about a curve, leave it waiting and ask.

### Fields to check before approving

- **Name**: experiment, year, and exposure if stated, e.g. `LZ 2024 (4.2 t·yr)` or
  `XENONnT 2025 (3.1 t·yr)`. Add the result type when one paper has several: `DarkSide-50 2023 (S2-only)`.
  Never keep names like "Power constrained upper limit".
- **Experiment**: the collaboration (LZ, XENON, PandaX, DarkSide, DEAP-3600, ...). The curve list groups
  by this field.
- **Year**: the arXiv year of the paper.
- **Plot type**: what the y-axis is.
  - Spin-independent DM-nucleon; spin-dependent DM-proton or DM-neutron
  - DM-electron, heavy mediator (F=1) or light mediator (F∝1/q²)
  - Ultra-heavy DM-nucleon (A⁴ scaling) or ultra-heavy DM-nucleus (A-independent): for multiple-scatter,
    Planck-scale searches
  - Dark photon absorption (kinetic mixing ε); axion-like particle absorption (g_ae)
  - Other: boosted, solar-reflected, inelastic, effective-operator, Migdal-only... Write the scenario in
    **Details**.
- **Kind**: Limit, Projection, Discovery contour (also set **Sigma** to 3 or 5), or Model prediction.
- **Details**: confidence level and anything special, e.g. `observed, 90% CL` or `S2-only, 90% CL`.

### Sanity checks

- Does the curve sit where the paper's does? The plot converts units for you, so a curve 10⁴ or 10⁹ too high
  or low means the figure's units were misread. Reject it and digitize by hand (below).
- The lowest point of a recent spin-independent limit from a large xenon or argon experiment is around
  10⁻⁴⁸ to 10⁻⁴⁶ cm². A curve that is wildly off, for example with values like 21 or 10⁺⁴⁷, comes from a
  misread figure.
- A curve that zig-zags or jumps doesn't match the paper. Reject it.

### Papers without a curve

**Papers without a curve** lists papers where the script found nothing usable (image-only figures,
unusual layouts).

- If the paper has no new limit plot at all, click **No new limit in this paper**.
- Otherwise click **Digitize from figure**. Take a screenshot of the figure, load it (or paste it with
  Ctrl/Cmd+V), and follow the prompts on the page. You click two known points on each axis and type their
  values, then click along the curve. Check **Log mass axis** and **Log limit axis**, which most of these
  plots use. The axis points stay set, so you can digitize several curves from one figure.

## Fixing published curves

**Published curves: rename or correct** lets you search any published curve by name, experiment, year,
arXiv number or curve number, edit it, and press **Save changes**. **Move back to review** hides it again.

## Problem reports from visitors

Visitors report mistakes with **Report a problem** on the public page. Reports arrive as GitHub issues
labeled `curve-correction` and are listed under **Problem reports from visitors** on the review page. A
curve with an open report shows a badge in the published list.

1. Click **Find curve N**, check the claim against the paper, and fix the curve if the report is right.
2. Press **Publish my changes and get new curves**.
3. On GitHub, reply on the issue saying what you changed, or why nothing needed changing, and close it.

## Seeing progress

`python3 tools/limits.py list | tail -2` prints how many curves are approved, waiting and rejected. The
review page shows the same counts in its section headings.

## If something goes wrong

- **The publish button reports a problem.** Read the message; it says what to do. Your work stays saved
  on your computer either way. If it mentions a git conflict you can't resolve, stop and ask Shawn rather
  than deleting anything.
- **The page says the database could not be loaded.** Run `python3 tools/limits.py doctor`, which checks
  and repairs it.
- **You approved or rejected something by mistake.** Use **Published curves** (to move it back to review)
  or **Rejected curves** (to restore it).
- **Never edit `tools/limits.sql` by hand** and never commit `tools/limits.db`. The publish button handles
  both.
