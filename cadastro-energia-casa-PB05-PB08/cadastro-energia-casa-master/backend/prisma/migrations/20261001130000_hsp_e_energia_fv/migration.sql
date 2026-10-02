-- AlterTable
ALTER TABLE "CenarioDimensionamento" ADD COLUMN     "energiaMensalFvKwh" DOUBLE PRECISION,
ADD COLUMN     "hspFonte" TEXT,
ADD COLUMN     "hspKwhM2Dia" DOUBLE PRECISION,
ADD COLUMN     "hspOrigem" TEXT;

-- Backfill: E_FV dos cenários criados antes do PB04
UPDATE "CenarioDimensionamento"
SET "energiaMensalFvKwh" = ROUND(("consumoReferenciaKwh" * "percentualAtendimento" / 100)::numeric, 2);

-- CreateTable
CREATE TABLE "CenarioCalculoLog" (
    "id" SERIAL NOT NULL,
    "cenarioId" INTEGER NOT NULL,
    "etapa" TEXT NOT NULL,
    "formula" TEXT NOT NULL,
    "entradas" JSONB NOT NULL,
    "resultado" DOUBLE PRECISION NOT NULL,
    "unidade" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CenarioCalculoLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CenarioCalculoLog" ADD CONSTRAINT "CenarioCalculoLog_cenarioId_fkey" FOREIGN KEY ("cenarioId") REFERENCES "CenarioDimensionamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
