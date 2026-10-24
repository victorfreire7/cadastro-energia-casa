-- CreateTable
CREATE TABLE "Projeto" (
    "id" SERIAL NOT NULL,
    "imovelId" INTEGER NOT NULL,
    "titulo" TEXT NOT NULL,
    "alternativa" TEXT NOT NULL,
    "entrada" JSONB NOT NULL,
    "resultado" JSONB NOT NULL,
    "investimentoTotalBrl" DOUBLE PRECISION NOT NULL,
    "economiaAnualBrl" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Projeto_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Projeto" ADD CONSTRAINT "Projeto_imovelId_fkey" FOREIGN KEY ("imovelId") REFERENCES "Imovel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
