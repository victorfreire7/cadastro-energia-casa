-- AlterTable
ALTER TABLE "Imovel" ADD COLUMN     "cidade" TEXT,
ADD COLUMN     "uf" TEXT;

-- CreateTable
CREATE TABLE "CenarioDimensionamento" (
    "id" SERIAL NOT NULL,
    "imovelId" INTEGER NOT NULL,
    "cidade" TEXT NOT NULL,
    "uf" TEXT NOT NULL,
    "consumoReferenciaKwh" DOUBLE PRECISION NOT NULL,
    "consumoOrigem" TEXT NOT NULL,
    "percentualAtendimento" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CenarioDimensionamento_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CenarioDimensionamento" ADD CONSTRAINT "CenarioDimensionamento_imovelId_fkey" FOREIGN KEY ("imovelId") REFERENCES "Imovel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
