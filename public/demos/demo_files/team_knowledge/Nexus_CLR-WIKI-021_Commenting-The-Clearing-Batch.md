# Commenting the clearing batch

| Field | Value |
|---|---|
| Document ID | CLR-WIKI-021 |
| Title | Commenting the clearing batch |
| Type | Wiki page, Clearing Engineering |
| Owner | Senior Engineer, Clearing Engineering (page owner: Priya Nair) |
| Approved by | David Vance (Head of Payments Engineering) |
| Version | 2 |
| Effective date | 2026-07-17 |
| Next review | 2027-07-16 |
| Classification | Internal |
| Status | Current |
| Applies to | Clearing Engineering: the comments in the clearing batch, `legacy/clearing-batch/CLEARING.cbl` |

## TL;DR

Internal Audit's finding DOC-2026-14: the clearing batch's comments fail the Code Documentation Standard (STD-DOC). We fix them in one comments-only change before cut-over, while the people who know the batch are still here. Use the header below, give every division, section and paragraph a purpose comment, put right what the old comments get wrong, and prove with the comment check and the COBOL check that no line of code changed.

## The header

Fill in the purpose and the history, and keep the box: an asterisk in column 7, the text from column 9, the closing asterisk in column 72.

```
      *================================================================*
      * PROGRAM:        CLEARING                                       *
      * PURPOSE:        <ONE OR TWO LINES: WHAT IT DOES AND WHY>       *
      * SERVICE:        CARD SETTLEMENT                                *
      * OWNER:          CLEARING ENGINEERING, PAYMENTS & SETTLEMENTS   *
      *                 TECHNOLOGY                                     *
      * CLASSIFICATION: INTERNAL                                       *
      * COPYRIGHT (C) NEXUS BANK PLC 1998-2026. ALL RIGHTS RESERVED.   *
      * NEXUS AND THE NEXUS LOGO ARE TRADE MARKS OF NEXUS BANK PLC.    *
      * HISTORY:        1998-09-14 FIRST WRITTEN BY NEXUS PAYMENTS LTD *
      *                 <YYYY-MM-DD> <CHANGE> <TICKET>, OLDEST FIRST   *
      * REQUIREMENTS:   PAY-012                                        *
      * AI-ASSISTED:    <WHAT THE ASSISTANT WROTE, AND WHICH ONE>      *
      *================================================================*
```

## Notes

**CLR-WIKI-021 C1: The header's fields.** The header is a box of comment lines, asterisks in columns 7 and 72, with these labels in capitals, in this order: PROGRAM, PURPOSE, SERVICE, OWNER, CLASSIFICATION, then the copyright line and the trade mark line, then HISTORY, REQUIREMENTS and AI-ASSISTED. A value too long for its line carries on under itself on the next.
Traces to: DOC-001 and DOC-007 (Code Documentation Standard).

**CLR-WIKI-021 C2: The facts for the header.** CLEARING was written for the mainframe by Nexus Payments Ltd, dated 14 September 1998, and Nexus Payments Ltd folded into the Bank on 1 April 2009. Since 2009 each fee has been rounded, not truncated, and since September 2021 the batch has run under GnuCOBOL on the batch host. It totals each night's settlement records for the Card settlement important business service; Clearing Engineering owns it; it is classified Internal; its fee calculation implements PAY-012.
Traces to: DOC-001 and DOC-006 (Code Documentation Standard).

**CLR-WIKI-021 C3: The notice is the Bank's.** The old header's COPYRIGHT (C) NEXUS PAYMENTS LTD 1998 is wrong. The notice names Nexus Bank plc, from 1998, and Nexus Payments Ltd goes in the history line instead (LEG-POL-001 clause 4.2).
Traces to: DOC-001 (Code Documentation Standard).

**CLR-WIKI-021 C4: What the old comments get wrong.** The header says fees are truncated to the penny: each fee is rounded on its own, half away from zero (CLR-WIKI-019 Q1), so correct the comment, never the code. The test card number goes, and the commented-out truncating COMPUTE goes too: git keeps it.
Traces to: DOC-003, DOC-004 and DOC-005 (Code Documentation Standard).

**CLR-WIKI-021 C5: Twelve units, twelve purpose comments.** The batch has four divisions, three sections (INPUT-OUTPUT, FILE and WORKING-STORAGE) and five paragraphs (FILE-CONTROL, MAIN-PARA, READ-REC, PROCESS-REC and WRITE-SCHEME). Each gets a comment saying what it does, directly above or directly below its line. Tag the fee's COMPUTE with PAY-012.
Traces to: DOC-002 and DOC-006 (Code Documentation Standard).

**CLR-WIKI-021 C6: Comments only, and prove it.** A line with an asterisk in column 7 is a comment; keep its text within column 72, and never touch a line of code, not even its spacing. Then run both checks and keep their results with the change: the comment check sets every comment and blank line aside and compares the code before and after, and nothing may differ; the COBOL check (CLR-WIKI-019) compiles the batch, runs it on the fixture and diffs the report against `expected_totals.txt`.
Traces to: DOC-008 (Code Documentation Standard).

The comment check, from the repository root (an empty diff means no line of code changed):

```
code_lines() { grep -v '^.\{6\}[*/]' | sed 's/ *$//' | grep -v '^$'; }
diff <(git show HEAD:legacy/clearing-batch/CLEARING.cbl | code_lines) <(code_lines < legacy/clearing-batch/CLEARING.cbl)
```

**CLR-WIKI-021 C7: Say NexCODE helped.** If NexCODE drafts the comments, the header's AI-ASSISTED line says so, the pull request is labelled AI-assisted, and a person reviews every comment, as for any change.
Traces to: DOC-007 (Code Documentation Standard); REV-005 (Code Review Standard).

## Page history

- **2026-07-15** First published for DOC-2026-14: the header template and its facts, what the old comments get wrong, the twelve units and the comment check. Reviewed by David Vance. (PN)
- **2026-07-17** The template's history opens with the batch's first entry, 1998, Nexus Payments Ltd, which LEG-POL-001 clause 4.2 puts in the history, never in the notice. (PN)
