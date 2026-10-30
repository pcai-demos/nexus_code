      *================================================================*
      * CLEARING - NIGHTLY CLEARING TOTALS BY SCHEME                   *
      * COPYRIGHT (C) NEXUS PAYMENTS LTD 1998. ALL RIGHTS RESERVED.    *
      *================================================================*
      * READS THE DAY'S SETTLEMENT RECORDS AND PRINTS THE TOTALS.      *
      * FEES ARE TRUNCATED TO THE PENNY BEFORE THEY ARE ADDED UP.      *
      * TESTED WITH CARD 4111111111111111 ON THE SCHEME SIMULATOR.     *
      *================================================================*
       IDENTIFICATION DIVISION.
       PROGRAM-ID. CLEARING.
       DATE-WRITTEN. 14/09/1998.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT SETTLE-IN ASSIGN TO "CLEARIN"
               ORGANIZATION IS LINE SEQUENTIAL.
           SELECT TOTALS-OUT ASSIGN TO "CLEAROUT"
               ORGANIZATION IS LINE SEQUENTIAL.
       DATA DIVISION.
       FILE SECTION.
       FD  SETTLE-IN.
       01  IN-REC.
           05 IN-TYPE              PIC X.
           05 IN-BUS-DATE          PIC 9(8).
           05 IN-SCHEME            PIC X(10).
           05 IN-TXN-ID            PIC X(12).
           05 IN-STATUS            PIC X.
           05 IN-AMOUNT            PIC S9(9)V99
                                   SIGN LEADING SEPARATE.
           05 IN-FEE-RATE          PIC 9V9(4).
       FD  TOTALS-OUT.
       01  OUT-LINE                PIC X(80).
       WORKING-STORAGE SECTION.
       01  WS-EOF                  PIC X VALUE "N".
       01  WS-RUN-DATE             PIC 9(8) VALUE 0.
       01  WS-CUR-SCHEME           PIC X(10) VALUE SPACES.
       01  WS-FEE                  PIC S9(9)V99.
       01  WS-SCHEME-TOTALS.
           05 WS-S-COUNT           PIC 9(5).
           05 WS-S-GROSS           PIC S9(11)V99.
           05 WS-S-FEES            PIC S9(11)V99.
           05 WS-S-NET             PIC S9(11)V99.
       01  WS-GRAND-TOTALS.
           05 WS-G-COUNT           PIC 9(5) VALUE 0.
           05 WS-G-GROSS           PIC S9(11)V99 VALUE 0.
           05 WS-G-FEES            PIC S9(11)V99 VALUE 0.
           05 WS-G-NET             PIC S9(11)V99 VALUE 0.
       01  WS-COUNTS.
           05 WS-READ              PIC 9(5) VALUE 0.
           05 WS-DECLINED          PIC 9(5) VALUE 0.
           05 WS-OTHER-DATE        PIC 9(5) VALUE 0.
       01  WS-DATE-PARTS.
           05 WD-YYYY              PIC 9(4).
           05 WD-MM                PIC 99.
           05 WD-DD                PIC 99.
       01  RPT-TITLE               PIC X(32)
               VALUE "NEXUS BANK PLC - CLEARING TOTALS".
       01  RPT-DATE-LINE.
           05 FILLER               PIC X(15) VALUE "BUSINESS DATE: ".
           05 RL-YYYY              PIC 9(4).
           05 FILLER               PIC X VALUE "-".
           05 RL-MM                PIC 99.
           05 FILLER               PIC X VALUE "-".
           05 RL-DD                PIC 99.
       01  RPT-HEADINGS.
           05 FILLER               PIC X(18) VALUE "SCHEME       COUNT".
           05 FILLER               PIC X(13) VALUE SPACES.
           05 FILLER               PIC X(5)  VALUE "GROSS".
           05 FILLER               PIC X(12) VALUE SPACES.
           05 FILLER               PIC X(4)  VALUE "FEES".
           05 FILLER               PIC X(15) VALUE SPACES.
           05 FILLER               PIC X(3)  VALUE "NET".
       01  RPT-DETAIL.
           05 RD-SCHEME            PIC X(10).
           05 FILLER               PIC X(2) VALUE SPACES.
           05 RD-COUNT             PIC ZZ,ZZ9.
           05 FILLER               PIC X(2) VALUE SPACES.
           05 RD-GROSS             PIC Z,ZZZ,ZZZ,ZZ9.99-.
           05 FILLER               PIC X(1) VALUE SPACES.
           05 RD-FEES              PIC ZZZ,ZZZ,ZZ9.99-.
           05 FILLER               PIC X(1) VALUE SPACES.
           05 RD-NET               PIC Z,ZZZ,ZZZ,ZZ9.99-.
       01  RPT-COUNT-LINE.
           05 FILLER               PIC X(6) VALUE "READ: ".
           05 RC-READ              PIC ZZ,ZZ9.
           05 FILLER               PIC X(12) VALUE "  DECLINED: ".
           05 RC-DECLINED          PIC ZZ,ZZ9.
           05 FILLER               PIC X(14) VALUE "  OTHER DATE: ".
           05 RC-OTHER             PIC ZZ,ZZ9.
       PROCEDURE DIVISION.
       MAIN-PARA.
           OPEN INPUT SETTLE-IN OUTPUT TOTALS-OUT
           PERFORM READ-REC
           IF IN-TYPE = "H"
               MOVE IN-BUS-DATE TO WS-RUN-DATE
               PERFORM READ-REC
           END-IF
           WRITE OUT-LINE FROM RPT-TITLE
           MOVE WS-RUN-DATE TO WS-DATE-PARTS
           MOVE WD-YYYY TO RL-YYYY
           MOVE WD-MM TO RL-MM
           MOVE WD-DD TO RL-DD
           WRITE OUT-LINE FROM RPT-DATE-LINE
           WRITE OUT-LINE FROM RPT-HEADINGS
           PERFORM UNTIL WS-EOF = "Y"
               PERFORM PROCESS-REC
               PERFORM READ-REC
           END-PERFORM
           IF WS-CUR-SCHEME NOT = SPACES
               PERFORM WRITE-SCHEME
           END-IF
           MOVE "TOTAL" TO RD-SCHEME
           MOVE WS-G-COUNT TO RD-COUNT
           MOVE WS-G-GROSS TO RD-GROSS
           MOVE WS-G-FEES TO RD-FEES
           MOVE WS-G-NET TO RD-NET
           WRITE OUT-LINE FROM RPT-DETAIL
           MOVE WS-READ TO RC-READ
           MOVE WS-DECLINED TO RC-DECLINED
           MOVE WS-OTHER-DATE TO RC-OTHER
           WRITE OUT-LINE FROM RPT-COUNT-LINE
           CLOSE SETTLE-IN TOTALS-OUT
           STOP RUN.
       READ-REC.
           READ SETTLE-IN
               AT END MOVE "Y" TO WS-EOF
           END-READ.
       PROCESS-REC.
           ADD 1 TO WS-READ
           IF IN-BUS-DATE NOT = WS-RUN-DATE
               ADD 1 TO WS-OTHER-DATE
           ELSE
               IF IN-STATUS = "D"
                   ADD 1 TO WS-DECLINED
               ELSE
                   IF IN-SCHEME NOT = WS-CUR-SCHEME
                       IF WS-CUR-SCHEME NOT = SPACES
                           PERFORM WRITE-SCHEME
                       END-IF
                       MOVE IN-SCHEME TO WS-CUR-SCHEME
                       INITIALIZE WS-SCHEME-TOTALS
                   END-IF
      *            COMPUTE WS-FEE = IN-AMOUNT * IN-FEE-RATE
                   COMPUTE WS-FEE ROUNDED = IN-AMOUNT * IN-FEE-RATE
                   ADD 1 TO WS-S-COUNT
                   ADD IN-AMOUNT TO WS-S-GROSS
                   ADD WS-FEE TO WS-S-FEES
                   COMPUTE WS-S-NET = WS-S-GROSS - WS-S-FEES
               END-IF
           END-IF.
       WRITE-SCHEME.
           MOVE WS-CUR-SCHEME TO RD-SCHEME
           MOVE WS-S-COUNT TO RD-COUNT
           MOVE WS-S-GROSS TO RD-GROSS
           MOVE WS-S-FEES TO RD-FEES
           MOVE WS-S-NET TO RD-NET
           WRITE OUT-LINE FROM RPT-DETAIL
           ADD WS-S-COUNT TO WS-G-COUNT
           ADD WS-S-GROSS TO WS-G-GROSS
           ADD WS-S-FEES TO WS-G-FEES
           ADD WS-S-NET TO WS-G-NET.
