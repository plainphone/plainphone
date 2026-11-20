# Plainphone design principles

These principles guide product decisions, including future work. See the
[evidence review](evidence.md) for the strength and limits of the research.

1. **Children know what their parents can see.** Use age-appropriate language
   and keep a page on the child's phone up to date with the rules and data
   visible to caregivers. [DSA ¶81(d)][dsa] · [ICO standard 11][ico] ·
   [Ghosh et al.](https://www.cs.ucf.edu/~jjl/pubs/pn1838-ghoshA.pdf)
2. **Keep monitoring visible.** Show a sign while location is being shared,
   notify children when location is requested, and show requests in a log on
   their phone. Every caregiver or emergency contact follows the same rules.
   [DSA ¶58(f), ¶81(d)][dsa] · [ICO standards 10–11][ico] · [UN GC25 ¶67][gc25]
3. **Keep help reachable.** Keep emergency calls, caregiver contact and
   helplines available across schedules and limits. Exempt these calls from
   usage caps and keep helpline use out of caregiver-visible logs.
   A test fails if any mode or limit blocks them ([always reachable](always-reachable.md)).
   [UN GC25 ¶¶76, 94][gc25]
4. **Set and explain rules together.** Help families agree on rules, show the
   reasons in language the child understands, and encourage adults to follow
   shared rules too. [Hiniker et al.](https://doi.org/10.1145/2818048.2819940) ·
   [Danish Health Authority](https://www.sst.dk/vidensbase/forebyggelse/anbefalinger-om-brug-af-skaerm/skaermbrug-i-fritiden-saadan-kan-du-goere) ·
   [Fikkers et al.][style]
5. **Give blocked screens a next step.** Explain the rule and offer one
   clear, friendly action, such as asking for more time. [DSA ¶81(a)][dsa] ·
   [Fikkers et al.][style]
6. **Let independence grow.** Set a date to review rules together, expand
   choices as the child grows, and make it possible to release the phone
   altogether. [UN GC25 ¶¶19, 85][gc25] · [DSA ¶57(f), ¶81(a)][dsa]
7. **Use neutral language and avoid engagement pressure.** Show figures
   without judgment, keep streaks and rewards out of the interface, and
   keep sales out of the child's experience. [DSA ¶57(b)(viii), ¶61(b), ¶69(l)][dsa] ·
   [Radesky et al.](https://doi.org/10.1001/jamanetworkopen.2022.17641)
8. **Collect as little as possible.** Prefer daily totals to timelines, keep
   data only as long as needed, and default to location on request when
   sharing is enabled. [DSA ¶57(b)(v), ¶65(d)][dsa] · [UN GC25 ¶68][gc25]
9. **Default to quiet at night.** Design bedtime around muted interruptions
   while preserving access to help. Recommend charging outside the bedroom.
   [DSA ¶57(b)(vii)][dsa] · [Carter et al.](https://doi.org/10.1001/jamapediatrics.2016.2341)
10. **Be honest about outcomes.** Describe the setting and the strength of
    the evidence. A filter can reduce exposure. Claims about protection,
    improved well-being or breaking addiction require evidence of those outcomes.
    [National Academies](https://www.nationalacademies.org/read/27396/chapter/2) ·
    [Przybylski & Nash](https://pubmed.ncbi.nlm.nih.gov/29995533/)
11. **Use caregiver tools to support conversations.** Offer prompts to talk
    through what a child encounters and why a family has chosen a rule.
    [DSA ¶80][dsa]
12. **Give adults friction with a way out.** Make cancelling an app opening
    easy. For commitments, provide limited emergency overrides and a way to
    leave the arrangement. [Grüning et al.](https://doi.org/10.1073/pnas.2213114120) ·
    [GoalKeeper](https://doi.org/10.1145/3314403)

[dsa]: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A52025XC05519
[ico]: https://ico.org.uk/media/about-the-ico/documents/2617010/code-of-practice-dpa-2018-age-appropriate-design-code_v_2_0.pdf
[gc25]: https://www.ohchr.org/en/documents/general-comments-and-recommendations/general-comment-no-25-2021-childrens-rights-relation
[style]: https://www.pattivalkenburg.nl/images/artikelen_pdf/2017_Fikkers_et_al_a_matter_of_style.pdf
