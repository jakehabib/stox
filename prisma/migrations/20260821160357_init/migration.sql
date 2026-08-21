-- CreateTable
CREATE TABLE "League" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerKey" TEXT,
    "seasonYear" INTEGER NOT NULL DEFAULT 2025,
    "startYear" INTEGER,
    "week" INTEGER NOT NULL DEFAULT 1,
    "phase" TEXT NOT NULL DEFAULT 'PRESEASON',
    "contractsAgedYear" INTEGER,
    "resignWarnedYear" INTEGER,
    "userTeamId" TEXT,
    "settings" TEXT NOT NULL,

    CONSTRAINT "League_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftState" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ROOKIE',
    "round" INTEGER NOT NULL DEFAULT 1,
    "pickIndex" INTEGER NOT NULL DEFAULT 0,
    "order" TEXT NOT NULL DEFAULT '[]',
    "complete" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DraftState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "abbr" TEXT NOT NULL,
    "conference" TEXT NOT NULL,
    "division" TEXT NOT NULL,
    "isUser" BOOLEAN NOT NULL DEFAULT false,
    "prestige" INTEGER NOT NULL DEFAULT 50,
    "offScheme" TEXT NOT NULL DEFAULT 'Balanced',
    "defScheme" TEXT NOT NULL DEFAULT '4-3 Base',
    "gmProfile" TEXT NOT NULL DEFAULT '{}',
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "ties" INTEGER NOT NULL DEFAULT 0,
    "pointsFor" INTEGER NOT NULL DEFAULT 0,
    "pointsAgnst" INTEGER NOT NULL DEFAULT 0,
    "divWins" INTEGER NOT NULL DEFAULT 0,
    "divLosses" INTEGER NOT NULL DEFAULT 0,
    "confWins" INTEGER NOT NULL DEFAULT 0,
    "confLosses" INTEGER NOT NULL DEFAULT 0,
    "playoffSeed" INTEGER,
    "eliminated" BOOLEAN NOT NULL DEFAULT false,
    "scoutPoints" INTEGER NOT NULL DEFAULT 0,
    "scoutPeriod" INTEGER NOT NULL DEFAULT 0,
    "scoutPeriodGrant" INTEGER NOT NULL DEFAULT 0,
    "scoutSpentSeason" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 50,
    "playCalling" INTEGER NOT NULL DEFAULT 50,
    "development" INTEGER NOT NULL DEFAULT 50,
    "scheme" TEXT NOT NULL DEFAULT 'Balanced',
    "contractYears" INTEGER NOT NULL DEFAULT 3,
    "salary" INTEGER NOT NULL DEFAULT 3000000,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scout" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accuracy" INTEGER NOT NULL DEFAULT 50,
    "speed" INTEGER NOT NULL DEFAULT 50,
    "specialty" TEXT NOT NULL DEFAULT 'ALL',
    "salary" INTEGER NOT NULL DEFAULT 500000,

    CONSTRAINT "Scout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "teamId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "experience" INTEGER NOT NULL DEFAULT 0,
    "heightIn" INTEGER NOT NULL DEFAULT 73,
    "weightLb" INTEGER NOT NULL DEFAULT 220,
    "college" TEXT NOT NULL DEFAULT 'State',
    "trueAttrs" TEXT NOT NULL,
    "trueOvr" INTEGER NOT NULL,
    "potential" INTEGER NOT NULL,
    "devTrait" TEXT NOT NULL DEFAULT 'Normal',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isDraftee" BOOLEAN NOT NULL DEFAULT false,
    "draftYear" INTEGER,
    "draftRound" INTEGER,
    "draftPickNo" INTEGER,
    "collegeStats" TEXT NOT NULL DEFAULT '{}',
    "combineTesting" TEXT NOT NULL DEFAULT '{}',
    "devFocus" INTEGER NOT NULL DEFAULT 0,
    "yearsUnsigned" INTEGER NOT NULL DEFAULT 0,
    "injuryWeeks" INTEGER NOT NULL DEFAULT 0,
    "injuryType" TEXT,
    "fatigue" INTEGER NOT NULL DEFAULT 0,
    "morale" INTEGER NOT NULL DEFAULT 70,
    "seasonStats" TEXT NOT NULL DEFAULT '{}',
    "careerStats" TEXT NOT NULL DEFAULT '{}',

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoutingReport" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "observed" TEXT NOT NULL DEFAULT '{}',
    "scoutedOvr" INTEGER NOT NULL DEFAULT 0,
    "ovrLow" INTEGER NOT NULL DEFAULT 0,
    "ovrHigh" INTEGER NOT NULL DEFAULT 99,
    "notes" TEXT NOT NULL DEFAULT '',
    "lastWeek" INTEGER NOT NULL DEFAULT 0,
    "passes" INTEGER NOT NULL DEFAULT 0,
    "periodPasses" INTEGER NOT NULL DEFAULT 0,
    "potConfidence" INTEGER NOT NULL DEFAULT 0,
    "attrsRevealed" TEXT NOT NULL DEFAULT '[]',
    "devRevealed" BOOLEAN NOT NULL DEFAULT false,
    "fullyRevealed" BOOLEAN NOT NULL DEFAULT false,
    "revealedYear" INTEGER NOT NULL DEFAULT 0,
    "workoutYear" INTEGER,

    CONSTRAINT "ScoutingReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShortlistEntry" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShortlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "teamId" TEXT,
    "years" INTEGER NOT NULL,
    "yearsRemaining" INTEGER NOT NULL,
    "signedYear" INTEGER NOT NULL,
    "baseSalaries" TEXT NOT NULL,
    "signingBonus" INTEGER NOT NULL DEFAULT 0,
    "guaranteed" INTEGER NOT NULL DEFAULT 0,
    "isRookieDeal" BOOLEAN NOT NULL DEFAULT false,
    "isFranchiseTag" BOOLEAN NOT NULL DEFAULT false,
    "voidYears" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapCharge" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "CapCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftPick" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "slot" INTEGER NOT NULL,
    "originalTeamId" TEXT NOT NULL,
    "ownerTeamId" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "playerId" TEXT,

    CONSTRAINT "DraftPick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepthChartSlot" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,

    CONSTRAINT "DepthChartSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonYear" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'REGULAR',
    "homeTeamId" TEXT NOT NULL,
    "awayTeamId" TEXT NOT NULL,
    "played" BOOLEAN NOT NULL DEFAULT false,
    "homeScore" INTEGER NOT NULL DEFAULT 0,
    "awayScore" INTEGER NOT NULL DEFAULT 0,
    "boxScore" TEXT NOT NULL DEFAULT '{}',
    "recap" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonYear" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "teamId" TEXT,
    "headline" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeOffer" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "fromTeamId" TEXT NOT NULL,
    "toTeamId" TEXT NOT NULL,
    "give" TEXT NOT NULL DEFAULT '[]',
    "request" TEXT NOT NULL DEFAULT '[]',
    "blurb" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "seasonYear" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamSeasonRecord" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "losses" INTEGER NOT NULL,
    "ties" INTEGER NOT NULL,
    "pointsFor" INTEGER NOT NULL,
    "pointsAgnst" INTEGER NOT NULL,
    "playoffResult" TEXT NOT NULL DEFAULT 'MISSED',

    CONSTRAINT "TeamSeasonRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueRecord" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "teamAbbr" TEXT NOT NULL,
    "seasonYear" INTEGER NOT NULL,

    CONSTRAINT "LeagueRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeRecord" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonYear" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "teamAId" TEXT NOT NULL,
    "teamBId" TEXT NOT NULL,
    "teamAAbbr" TEXT NOT NULL,
    "teamBAbbr" TEXT NOT NULL,
    "aToB" TEXT NOT NULL,
    "bToA" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DynastyProfile" (
    "id" TEXT NOT NULL,
    "ownerKind" TEXT NOT NULL DEFAULT 'LEAGUE',
    "ownerKey" TEXT NOT NULL,
    "leagueId" TEXT,
    "skills" TEXT NOT NULL DEFAULT '{}',
    "fullScoutYear" INTEGER NOT NULL DEFAULT 0,
    "fullScoutUsed" INTEGER NOT NULL DEFAULT 0,
    "insiderYear" INTEGER NOT NULL DEFAULT 0,
    "insiderUsed" INTEGER NOT NULL DEFAULT 0,
    "workoutYear" INTEGER NOT NULL DEFAULT 0,
    "workoutUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DynastyProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DraftState_leagueId_key" ON "DraftState"("leagueId");

-- CreateIndex
CREATE INDEX "Team_leagueId_idx" ON "Team"("leagueId");

-- CreateIndex
CREATE INDEX "Staff_teamId_idx" ON "Staff"("teamId");

-- CreateIndex
CREATE INDEX "Scout_teamId_idx" ON "Scout"("teamId");

-- CreateIndex
CREATE INDEX "Player_leagueId_idx" ON "Player"("leagueId");

-- CreateIndex
CREATE INDEX "Player_teamId_idx" ON "Player"("teamId");

-- CreateIndex
CREATE INDEX "Player_position_idx" ON "Player"("position");

-- CreateIndex
CREATE INDEX "ScoutingReport_teamId_idx" ON "ScoutingReport"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "ScoutingReport_playerId_teamId_key" ON "ScoutingReport"("playerId", "teamId");

-- CreateIndex
CREATE INDEX "ShortlistEntry_teamId_idx" ON "ShortlistEntry"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "ShortlistEntry_playerId_teamId_key" ON "ShortlistEntry"("playerId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_playerId_key" ON "Contract"("playerId");

-- CreateIndex
CREATE INDEX "CapCharge_teamId_year_idx" ON "CapCharge"("teamId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "DraftPick_playerId_key" ON "DraftPick"("playerId");

-- CreateIndex
CREATE INDEX "DraftPick_leagueId_year_round_slot_idx" ON "DraftPick"("leagueId", "year", "round", "slot");

-- CreateIndex
CREATE INDEX "DraftPick_ownerTeamId_idx" ON "DraftPick"("ownerTeamId");

-- CreateIndex
CREATE INDEX "DepthChartSlot_teamId_idx" ON "DepthChartSlot"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "DepthChartSlot_teamId_position_rank_key" ON "DepthChartSlot"("teamId", "position", "rank");

-- CreateIndex
CREATE INDEX "Game_leagueId_seasonYear_week_idx" ON "Game"("leagueId", "seasonYear", "week");

-- CreateIndex
CREATE INDEX "Transaction_leagueId_seasonYear_week_idx" ON "Transaction"("leagueId", "seasonYear", "week");

-- CreateIndex
CREATE INDEX "TradeOffer_leagueId_toTeamId_status_idx" ON "TradeOffer"("leagueId", "toTeamId", "status");

-- CreateIndex
CREATE INDEX "TeamSeasonRecord_leagueId_year_idx" ON "TeamSeasonRecord"("leagueId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "TeamSeasonRecord_teamId_year_key" ON "TeamSeasonRecord"("teamId", "year");

-- CreateIndex
CREATE INDEX "LeagueRecord_leagueId_idx" ON "LeagueRecord"("leagueId");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueRecord_leagueId_scope_category_key" ON "LeagueRecord"("leagueId", "scope", "category");

-- CreateIndex
CREATE INDEX "TradeRecord_leagueId_createdAt_idx" ON "TradeRecord"("leagueId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DynastyProfile_leagueId_key" ON "DynastyProfile"("leagueId");

-- CreateIndex
CREATE UNIQUE INDEX "DynastyProfile_ownerKind_ownerKey_key" ON "DynastyProfile"("ownerKind", "ownerKey");

-- AddForeignKey
ALTER TABLE "DraftState" ADD CONSTRAINT "DraftState_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scout" ADD CONSTRAINT "Scout_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoutingReport" ADD CONSTRAINT "ScoutingReport_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoutingReport" ADD CONSTRAINT "ScoutingReport_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortlistEntry" ADD CONSTRAINT "ShortlistEntry_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortlistEntry" ADD CONSTRAINT "ShortlistEntry_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPick" ADD CONSTRAINT "DraftPick_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPick" ADD CONSTRAINT "DraftPick_originalTeamId_fkey" FOREIGN KEY ("originalTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPick" ADD CONSTRAINT "DraftPick_ownerTeamId_fkey" FOREIGN KEY ("ownerTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPick" ADD CONSTRAINT "DraftPick_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepthChartSlot" ADD CONSTRAINT "DepthChartSlot_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepthChartSlot" ADD CONSTRAINT "DepthChartSlot_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOffer" ADD CONSTRAINT "TradeOffer_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOffer" ADD CONSTRAINT "TradeOffer_fromTeamId_fkey" FOREIGN KEY ("fromTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamSeasonRecord" ADD CONSTRAINT "TeamSeasonRecord_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamSeasonRecord" ADD CONSTRAINT "TeamSeasonRecord_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueRecord" ADD CONSTRAINT "LeagueRecord_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeRecord" ADD CONSTRAINT "TradeRecord_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DynastyProfile" ADD CONSTRAINT "DynastyProfile_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

