<script setup lang="ts">
import { computed } from 'vue';
import { formatCentsAsCurrency } from '@shared/utils/money';
const props = defineProps<{ cents: number }>();
const value = computed(() => formatCentsAsCurrency(props.cents));
</script>
<template><span class="money-value">{{ value }}</span></template>
