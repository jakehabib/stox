-- How long a free agent has been on the wire, in league weeks. See the column
-- comment in schema.prisma: this is the clock his asking price falls on.
ALTER TABLE "Player" ADD COLUMN "weeksUnsigned" INTEGER NOT NULL DEFAULT 0;

-- Seed it for saves that predate the column. A man the yearly counter already
-- says has been unsigned for whole seasons must not be quoted his April price
-- just because the weekly clock started at zero today. A league year is 30
-- ticks of this clock — 33 advance steps (1 preseason + 17 regular + 4 playoff
-- rounds + 5 offseason + 1 re-sign + 4 free agency + 1 draft), less the three
-- playoff rounds that do not move League.week and so do not age the wire.
UPDATE "Player" SET "weeksUnsigned" = "yearsUnsigned" * 30
WHERE "status" = 'FREE_AGENT' AND "yearsUnsigned" > 0;
