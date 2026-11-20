# Evidence behind Plainphone

Sources last checked **17 November 2026**. These are design judgments about
related research, including studies on other products. We have no direct outcome
study of Plainphone or comparison of a restricted phone with both a full
smartphone and no phone. An observational association does not establish cause.
Official guidance informs design choices and carries no estimate of their effect.

The National Academies review (released in 2023, formally cited as 2024) found
insufficient evidence for a population-level causal effect of social media on
adolescent health. Across three large datasets, digital technology use explained
at most 0.4% of the variation in adolescent well-being. An experience-sampling
study found differences between teens, and longitudinal associations varied by
age and sex in another study. These results do not predict an individual child's
response. [National Academies](https://www.nationalacademies.org/read/27396/chapter/2),
[Orben & Przybylski 2019](https://doi.org/10.1038/s41562-018-0506-1),
[Beyens et al. 2020](https://pubmed.ncbi.nlm.nih.gov/32612108/),
[Orben et al. 2022](https://pubmed.ncbi.nlm.nih.gov/35347142/).

## By feature

| Feature | Rationale | Strength | What to watch for | Sources |
| --- | --- | --- | --- | --- |
| Locked phone and app list | A way to offer selected apps while delaying access to a full smartphone. Family research supports making rules concrete. | Indirect; weak for outcomes | Strict controls can invite workarounds. Higher online risk among teens using parental-control apps could reflect why families adopted them. | [Danish Wellbeing Commission][commission], [Hiniker et al.](https://doi.org/10.1145/2818048.2819940), [Ghosh et al.](https://doi.org/10.1145/3173574.3173768) |
| Approved calls and texts | A list can limit who can call or text through supported phone and SMS apps. | Weak; no direct outcome evidence | Rigid lists can cut off help. Design for emergency calls, caregivers and confidential helplines. The DSA examples concern online accounts. | [UN GC25 ¶¶76, 94][gc25], [DSA ¶82][dsa] |
| DNS web filter | Blocking domains in selected categories can reduce some exposure. | Weak for exposure outcomes; documented overblocking | In exploratory EU data, filter use accounted for under 0.5% of variation in reported exposure to sexual material. The preregistered UK study found no consistent benefit. Filters can miss material and block legitimate health and sexuality information. | [Przybylski & Nash][filter], [Richardson et al.](https://doi.org/10.1001/jama.288.22.2887), [DSA ¶80][dsa] |
| Per-app limits, daily cap and exempt apps | Families can set limits in advance and keep selected apps available. | Moderate for limiting use, weak for well-being | Restrictive locks can frustrate users. Provide warning, a way to request time and access to help. Adult commitment studies transfer only indirectly to children. | [Danish Health Authority][sst], [Collier et al.](https://pubmed.ncbi.nlm.nih.gov/26914217/), [Allcott et al. 2022][commitment], [GoalKeeper][goalkeeper] |
| Weekly summary and "only alert me when I must act" | One overview a week for parents instead of a stream of alerts. Urgent news (SOS, requests, removed protection) is never held back. | Indirect: batching notifications improved well-being in a small adult trial; no study of parental alerts | The adult sample may not transfer to parents, and a late summary must not hide something urgent. Only daily totals are kept, not timelines, and the figures are neutral. See [docs/weekly-summary.md](weekly-summary.md). | [Fitz et al. 2019](https://doi.org/10.1016/j.chb.2019.07.016), design principles 7 and 8 |
| School time | Schedule selected app access around a school's own rules. | Mixed for school policies; indirect for a scheduled app limit | English observational data found less use in school, with no clear difference in overall use or well-being. Norwegian results are from a working paper. | [Goodyear et al.][school], [Campbell et al.](https://doi.org/10.1177/20556365241270394), [Abrahamsson working paper](https://doi.org/10.2139/ssrn.4735240), [L 130][bill] |
| Bedtime | Device access and use around bedtime are associated with shorter or poorer sleep. A schedule can limit access at bedtime. | Consistent observational evidence; causal benefit of the feature uncertain | Studies vary. A Danish short-term screen reduction trial found no significant sleep differences. Keep the phone outside the bedroom as recommended by the Danish Health Authority. | [Carter et al.][sleep], [Pedersen et al.](https://doi.org/10.1001/jamapediatrics.2022.1519), [Danish Health Authority][sst], [DSA ¶57(b)(vii)][dsa] |
| Nightly app updates in strong mode | Updates fix security holes; a locked phone that never updates its apps keeps known holes open. A bounded window at night keeps the lock everywhere else. | Official security guidance; no study of the window itself | Updates need a signed-in Play and a phone that charges on Wi-Fi at night. New apps installed in the window stay hidden until a parent approves. | [NCSC: install the latest software and app updates](https://www.ncsc.gov.uk/collection/top-tips-for-staying-secure-online/install-the-latest-software-and-app-updates) |
| Location, Find, check-in and ring | Finding a phone or checking where it is can address a specific need. | Weak for benefits; clear transparency guidance | Repeated checks can feel intrusive. Use visible, limited sharing. A request that can send location without a reply needs an explanation on the child's screen. | [Stattin & Kerr](https://doi.org/10.1111/1467-8624.00210), [ICO standards 10–11][ico], [DSA ¶¶58(f), 81(d)][dsa], [UN GC25 ¶67][gc25] |
| Child requests for apps, contacts or time | A request provides room for conversation and reconsideration. | Moderate indirect support; much of the evidence is observational | Give reasons and show request status. A request with no response offers little agency. | [Fikkers et al.][style], [Wisniewski et al.][teen], [DSA ¶81(a)][dsa] |
| Screen-time charts and unlock counts | Shared summaries can start a conversation about rules. | Weak and indirect | Detailed timelines can feel like constant monitoring. Keep summaries coarse and visible to the child, with neutral language. | [Wisniewski et al.][teen], [Self-control review][self-review], [DSA ¶65(d)][dsa] |
| Home screen without badges | A simpler home screen has fewer prompts to open apps. | Weak direct evidence; indirect experimental and design evidence | Notification trials do not isolate badge removal or test the launcher as a whole. Preserve useful prompts. | [Fitz et al.][batch], [Kushlev et al.](https://doi.org/10.1145/2858036.2858359), [Lyngs et al.](https://doi.org/10.1145/3290605.3300361), [DSA ¶61(b)][dsa] |
| Self commitment delay or trusted person | Adults can choose limits in advance and add friction to changing them. | Moderate for short-term use; indirect for a trusted approver | Strong locks can frustrate. Provide a way to leave and keep trusted-person access limited to approvals. | [Allcott et al. 2022][commitment], [GoalKeeper][goalkeeper], [Self-control review][self-review] |
| Strictness levels and emergency openings (Self) | Three named levels (Mild, Firm, Strict) reduce setup to one decision. A few counted, logged openings keep the commitment while leaving a small way out. | Indirect; no direct evidence for the allowance or the numbers | Strong locks can frustrate and invite workarounds. The 3 x 15 minutes are a design choice, not a finding. The trusted person is told, not asked. See [docs/emergency-openings.md](emergency-openings.md). | [Allcott et al. 2022][commitment], [GoalKeeper][goalkeeper], [Self-control review][self-review] |
| Pause before opening an app and increasing delays | A pause and a clear cancel action create a choice before opening an app. | Moderate for the pause intervention; no direct evidence for increasing delays | The field study lacked a control group and the rate of cancelled openings declined over time. The separate experiment found the option to cancel was the strongest component. | [Grüning et al.][pause] |
| Grayscale | A display option that can reduce phone use in the short term. | Weak to moderate, short-term | Long-term benefits remain uncertain. Other devices can substitute for the phone. | [Zimmermann & Sobolev](https://pubmed.ncbi.nlm.nih.gov/36577008/), [Dekker & Baumgartner](https://doi.org/10.1177/20501579231212062) |
| Weekly summary | Batch routine information and invite a conversation. | Indirect evidence from notification batching | A batching trial did not study parents' weekly summaries. Keep genuinely urgent notices separate. | [Fitz et al.][batch] |
| Growing independence: age presets and a review date | Review limits and expand a child's choices as their capacity grows. Presets give a starting point for an age; a review date brings the parents back to open more. The goal shown is a phone that is released one day. | Supported by rights guidance; indirect evidence for implementation | Review rules with the child. Age presets and reminders have no established effect, so the presets are defaults a family changes, they lock nothing, and the reminder can be switched off. See [docs/age-presets.md](age-presets.md). | [UN GC25 ¶¶19, 85][gc25], [DSA ¶¶57(f), 81(a)][dsa], [Fikkers et al.][style] |
| Family agreement | Parent and child write a few rules together, in the child's words, and the child sees them on the phone. The adults can add rules for themselves. | Moderate indirect support; mostly observational | An agreement is not enforcement, and the adults' lines are suggestions. It is optional and editable so it does not become pressure. No study shows a written agreement changes outcomes. See [docs/family-agreement.md](family-agreement.md). | [Hiniker et al.](https://doi.org/10.1145/2818048.2819940), [Danish Health Authority: screen agreements in the family][sst], [AAP Family Media Plan](https://www.healthychildren.org/English/fmp/Pages/MediaPlan.aspx), [Stattin & Kerr](https://doi.org/10.1111/1467-8624.00210) |

## Source notes

- The Danish Health Authority's recommendations date to October 2023. The
  June 2024 implementation advice gives a recreational screen-time range of
  up to 1–2 hours daily for ages 5–17 depending on age and advises keeping
  phones out of the bedroom. [Publication and advice][sst]
- In February 2025 the Danish Wellbeing Commission recommended waiting until
  13 for a smartphone or a tablet of one's own. Denmark's 2025 political
  agreement on mobile-free schools led to bill L 130 (2025–26, first session),
  which lapsed. School time can be set to match local school rules.
  [Commission][commission] · [Folketing record][bill]
- The European Commission's 2025 DSA Article 28(4) guidelines address providers
  of online platforms accessible to minors. Paragraphs 57(b)(v), (vii) and
  (viii) address tracking defaults, push notifications (including core sleep
  hours) and engagement features such as streaks. Paragraph 57(f) addresses
  graduated control, 58(f) visible indicators while geolocation is on,
  61(b) attention-oriented design, 65(d) the feeling of continuous monitoring
  in recommender systems, and 69(l) manipulative rewards in commercial design.
  Paragraphs 80–82 cover guardian tools, including complementary safeguards
  (80), autonomy (81(a)), and child notification and real-time indicators
  (81(d)). Plainphone uses these as design references. [Commission guidelines][dsa]
- The UK ICO Children's Code standard 10 calls for geolocation off by default
  unless there is a compelling reason grounded in the child's best interests,
  a visible sign when tracking is active, and shared visibility to reset after
  each session. Standard 11 calls for age-appropriate information and a visible
  sign when parents monitor activity or location. [ICO code standards][ico]
- The four-week Facebook deactivation experiment found increased subjective
  well-being and reduced later Facebook use in its study population. This
  does not establish the effect of a pause, a launcher or a child's phone.
  [Allcott et al. 2020](https://doi.org/10.1257/aer.20190658)

[commission]: https://regeringen.dk/aktuelt/nyheder/2025/trivselskommissionens-anbefalinger-er-klar/
[sst]: https://www.sst.dk/udgivelser/2023/Sundhedsstyrelsens-anbefalinger-om-skaermbrug
[bill]: https://www.ft.dk/samling/20251/lovforslag/l130/index.htm
[dsa]: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A52025XC05519
[ico]: https://ico.org.uk/media/about-the-ico/documents/2617010/code-of-practice-dpa-2018-age-appropriate-design-code_v_2_0.pdf
[gc25]: https://www.ohchr.org/en/documents/general-comments-and-recommendations/general-comment-no-25-2021-childrens-rights-relation
[filter]: https://doi.org/10.1089/cyber.2017.0466
[school]: https://doi.org/10.1016/j.lanepe.2025.101211
[sleep]: https://doi.org/10.1001/jamapediatrics.2016.2341
[style]: https://www.pattivalkenburg.nl/images/artikelen_pdf/2017_Fikkers_et_al_a_matter_of_style.pdf
[teen]: https://doi.org/10.1145/2998181.2998352
[commitment]: https://doi.org/10.1257/aer.20210867
[goalkeeper]: https://doi.org/10.1145/3314403
[self-review]: https://doi.org/10.1145/3571810
[batch]: https://doi.org/10.1016/j.chb.2019.07.016
[pause]: https://doi.org/10.1073/pnas.2213114120
