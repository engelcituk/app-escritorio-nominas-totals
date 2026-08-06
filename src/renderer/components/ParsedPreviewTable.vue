<script setup lang="ts">
import { computed, ref } from 'vue';
import { PAYROLL_FIELD_LABELS } from '@shared/payroll-layouts/payrollFieldLabels';
import type { PreviewRecord } from '@shared/types/payroll';
import MoneyValue from './MoneyValue.vue';
import StatusBadge from './StatusBadge.vue';

const INITIAL_ROWS = 5;
const props = defineProps<{ rows: PreviewRecord[] }>();
const expanded = ref(false);
const visibleRows = computed(() => expanded.value ? props.rows : props.rows.slice(0, INITIAL_ROWS));
const hiddenCount = computed(() => Math.max(0, props.rows.length - INITIAL_ROWS));
</script>

<template>
  <section class="preview-list" aria-labelledby="preview-list-title">
    <header class="preview-list__header">
      <div>
        <span class="eyebrow">Vista previa interpretada</span>
        <h4 id="preview-list-title">{{ rows.length }} movimientos de muestra</h4>
      </div>
      <p>Revisa empleado, concepto e importe. Los datos contables permanecen disponibles en el detalle.</p>
    </header>

    <ol class="preview-list__items">
      <li v-for="row in visibleRows" :key="row.lineNumber" class="preview-record" :class="{ 'is-invalid': !row.valid }">
        <div class="preview-record__summary">
          <div class="preview-record__line" :aria-label="`Línea ${row.lineNumber}`">
            <span>Línea</span><strong>{{ row.lineNumber }}</strong>
          </div>

          <div class="preview-record__employee">
            <span class="preview-record__label">Empleado {{ row.employeeNumber || 'sin número' }}</span>
            <strong>{{ row.employeeName || 'Nombre no disponible' }}</strong>
          </div>

          <div class="preview-record__concept">
            <span class="preview-record__label">Concepto {{ row.conceptCode || 'sin código' }}</span>
            <strong>{{ row.conceptDescriptionOriginal || 'Descripción no disponible' }}</strong>
            <small>Movimiento {{ row.movementType || 'no indicado' }}</small>
          </div>

          <div class="preview-record__amount">
            <span class="preview-record__label">Importe</span>
            <MoneyValue v-if="row.amountCents !== null" :cents="row.amountCents" />
            <strong v-else>—</strong>
          </div>

          <StatusBadge :status="row.valid ? 'VALID' : 'INVALID'" />
        </div>

        <div v-if="row.errors.length" class="preview-record__errors" role="alert">
          <i class="bi bi-exclamation-circle" aria-hidden="true" />
          <span>{{ row.errors.join(' ') }}</span>
        </div>

        <details class="preview-record__details">
          <summary>Ver datos contables</summary>
          <dl>
            <div><dt>{{ PAYROLL_FIELD_LABELS.dependencyKey }}</dt><dd>{{ row.dependencyKey || 'No informada' }}</dd></div>
            <div><dt>Cuenta contable</dt><dd>{{ row.accountCode || 'No informada' }}</dd></div>
            <div><dt>{{ PAYROLL_FIELD_LABELS.fundingSource }}</dt><dd>{{ row.fundingSource || 'No informada' }}</dd></div>
            <div><dt>{{ PAYROLL_FIELD_LABELS.paymentCenter }}</dt><dd>{{ row.paymentCenter || 'No informado' }}</dd></div>
          </dl>
        </details>
      </li>
    </ol>

    <footer v-if="hiddenCount" class="preview-list__footer">
      <button class="btn btn-outline-secondary btn-sm" type="button" :aria-expanded="expanded" @click="expanded = !expanded">
        <i class="bi" :class="expanded ? 'bi-chevron-up' : 'bi-chevron-down'" aria-hidden="true" />
        {{ expanded ? 'Mostrar solo los primeros 5' : `Mostrar ${hiddenCount} movimientos restantes` }}
      </button>
    </footer>
  </section>
</template>
