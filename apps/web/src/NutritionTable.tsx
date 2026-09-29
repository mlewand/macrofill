import type { NutritionValues } from '@macrofill/domain';
import { useTranslation } from 'react-i18next';
import { formatGrams, formatKcal } from './format';

const shown = ['protein', 'fat', 'carbs', 'fibre', 'kcal'] as const;

/** The nutrients the UI shows. An unknown total reads "unknown" (M2-3), never 0. */
export function NutritionTable({ values }: { values: NutritionValues }) {
  const { t } = useTranslation();
  return (
    <table className="nutrition">
      <tbody>
        {shown.map((nutrient) => {
          const value = values[nutrient];
          const text =
            value === null
              ? t('unknown')
              : nutrient === 'kcal'
                ? t('unit.kcal', { value: formatKcal(value) })
                : t('unit.grams', { value: formatGrams(value) });
          return (
            <tr key={nutrient}>
              <th scope="row">{t(`nutrient.${nutrient}`)}</th>
              <td>{text}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
