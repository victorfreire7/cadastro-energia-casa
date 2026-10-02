-- AlterTable (PB05): parâmetros e resultado do cálculo de potência FV
ALTER TABLE "CenarioDimensionamento" ADD COLUMN     "fatorDesempenho" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
ADD COLUMN     "diasConsiderados" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "potenciaFvKwp" DOUBLE PRECISION;

-- Backfill: P_FV dos cenários criados antes do PB05 (η = 0,8 e D = 30 padrão)
UPDATE "CenarioDimensionamento"
SET "potenciaFvKwp" = ROUND(("energiaMensalFvKwh" / ("hspKwhM2Dia" * 30 * 0.8))::numeric, 3)
WHERE "energiaMensalFvKwh" IS NOT NULL AND "hspKwhM2Dia" IS NOT NULL AND "hspKwhM2Dia" > 0;
