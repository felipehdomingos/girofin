import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { addMonths, formatMonthLong } from "@/lib/dates";

/**
 * Navegação entre meses.
 *
 * Existe porque compromisso não respeita o mês corrente: uma fatura que vence
 * em 13/10 simplesmente não aparecia numa tela travada em setembro, e não havia
 * como saber que ela existia. Parcela de compra em 6x tem o mesmo problema —
 * cinco das seis parcelas estão sempre no futuro.
 *
 * Links de verdade (não estado local) para o mês ficar na URL: dá para voltar
 * pelo botão do navegador e compartilhar a tela de um mês específico.
 */
export function MonthNav({
  month,
  basePath,
}: {
  /** "YYYY-MM" */
  month: string;
  /** Rota que recebe o parâmetro ?mes= */
  basePath: string;
}) {
  const anterior = addMonths(month, -1);
  const proximo = addMonths(month, 1);

  return (
    <div className="flex items-center gap-md">
      <Link
        href={`${basePath}?mes=${anterior}`}
        aria-label={`Ver ${formatMonthLong(anterior)}`}
        className="flex size-9 cursor-pointer items-center justify-center rounded-control border border-border text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </Link>

      <span className="min-w-[9rem] text-center text-sm font-medium capitalize">
        {formatMonthLong(month)}
      </span>

      <Link
        href={`${basePath}?mes=${proximo}`}
        aria-label={`Ver ${formatMonthLong(proximo)}`}
        className="flex size-9 cursor-pointer items-center justify-center rounded-control border border-border text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground"
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
