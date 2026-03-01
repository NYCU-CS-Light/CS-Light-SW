<template>
  <div class="h-full bg-white border-l p-4 flex flex-col gap-4">
    <h2 class="text-lg font-bold">Properties</h2>

    <div v-if="selectedSegment" class="flex flex-col gap-4">
      <div class="text-sm text-gray-500">ID: {{ selectedSegment.id }}</div>


      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium">Start Time (s)</label>
        <input 
            type="number" 
            step="0.01" 
            v-model.number="selectedSegment.start"
            class="border rounded px-2 py-1 text-sm" 
        />
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium">End Time (s)</label>
        <input 
            type="number" 
            step="0.01" 
            v-model.number="selectedSegment.end"
            class="border rounded px-2 py-1 text-sm" 
        />
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium">Type</label>
        <select class="border rounded px-2 py-1 text-sm">
            <option value="0">FADE</option>
            <option value="1">BLINK</option>
            <option value="2">SOLID</option>
        </select>
      </div>

      <hr />
      
      <h3 class="font-bold">Parameters</h3>
      <!-- Dynamic params based on ISA later -->
      
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium">Color (RGB)</label>
        <div class="flex gap-2">
            <input type="number" v-model.number="myParams.r" placeholder="R" class="border rounded px-1 py-1 text-xs w-full" />
            <input type="number" v-model.number="myParams.g" placeholder="G" class="border rounded px-1 py-1 text-xs w-full" />
            <input type="number" v-model.number="myParams.b" placeholder="B" class="border rounded px-1 py-1 text-xs w-full" />
        </div>
      </div>

       <div class="flex flex-col gap-1">
        <label class="text-sm font-medium">Speed</label>
        <input type="range" min="0" max="255" v-model.number="myParams.speed" />
        <span>{{ myParams.speed }}</span>
      </div>
      
      <button class="bg-red-500 text-white p-2 rounded mt-4" @click="handleDelete">
        Delete Segment
      </button>

    </div>
    <div v-else class="text-gray-400 text-center mt-10">
      Select a region <br />
      to edit parameters
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useProjectStore } from '../stores/projectStore'

const projectStore = useProjectStore()

const selectedSegment = computed(() => {
  return projectStore.getSegmentById(projectStore.selectedSegmentId)
})

// Proxy for params to avoid deep mutation issues directly in v-model occasionally
// But for Vue 3 + Pinia direct mutation is usually fine if reactive.
// Let's create a computed for params for cleaner access
const myParams = computed(() => {
  if (!selectedSegment.value) return {}
  if (!selectedSegment.value.params) selectedSegment.value.params = { r: 0, g: 0, b: 0, speed: 0 }
  return selectedSegment.value.params
})

const handleDelete = () => {
  if (selectedSegment.value) {
    // We also need to remove the region from wavesurfer instance
    // But the store doesn't have reference to wavesurfer instance directly.
    // Usually we emit an event or rely on reactivity if TimelineEditor watches the store properly.
    // For this MVP, we remove from store, but WaveSurfer region might persist until refresh unless we handle it.
    // Better: Emit event to central controller (HomeView/App) that orchestrates.
    projectStore.removeSegment(selectedSegment.value.id)

    // Note: TimelineEditor needs to accept a prop or watch store to remove region from UI
  }
}
</script>

<style scoped>
/* Removed @apply to fix Tailwind v4 integration */

</style>
