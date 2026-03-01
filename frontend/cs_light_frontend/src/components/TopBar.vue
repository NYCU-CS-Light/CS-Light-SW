<template>
  <div class="p-4 bg-gray-100 border-b flex justify-between items-center">
    <div class="flex items-center gap-4">
      <h1 class="text-xl font-bold">CS Light Studio</h1>

      <input
        type="file"
        ref="fileInput"
        accept="audio/*"
        class="hidden"
        @change="handleFileUpload"
      />
      <button class="px-4 py-2 rounded font-medium transition-colors bg-gray-200 text-gray-800 hover:bg-gray-300" @click="$refs.fileInput.click()">
        Load Float Audio
      </button>

      <span v-if="projectStore.fileName" class="text-sm text-gray-600">
        {{ projectStore.fileName }}
      </span>
    </div>

    <div class="flex gap-2">
      <button class="px-4 py-2 rounded font-medium transition-colors bg-blue-500 text-white hover:bg-blue-600" @click="emit('playPause')">
        {{ isPlaying ? 'Pause' : 'Play' }}
      </button>
      <button class="px-4 py-2 rounded font-medium transition-colors bg-green-500 text-white hover:bg-green-600" @click="handleExport">
        Export Binary
      </button>
    </div>

  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useProjectStore } from '../stores/projectStore'
import axios from 'axios'

const projectStore = useProjectStore()
const emit = defineEmits(['playPause', 'audioLoaded'])
const isPlaying = ref(false)

// In a real app, bind isPlaying to wavesurfer state via props or store
// For now, toggle button text manually or via parent

const handleFileUpload = async (event) => {
  const file = event.target.files[0]
  if (!file) return

  // Create local URL for playback
  const url = URL.createObjectURL(file)
  projectStore.setAudio(url, file)

  // Send to backend for analysis
  await analyzeAudio(file)

  emit('audioLoaded')
}

const analyzeAudio = async (file) => {
  const formData = new FormData()
  formData.append('file', file)

  try {
    // Assuming backend is on port 8000
    const response = await axios.post('http://127.0.0.1:8000/api/analyze-audio', formData)
    console.log('Analysis result:', response.data)

    // Store beats
    projectStore.setBeats(response.data.beats)
  } catch (error) {
    console.error('Error analyzing audio:', error)
    alert('Audio analysis failed. Is the backend running?')
  }
}

const handleExport = async () => {
  try {
    const payload = {
      segments: projectStore.segments.map((s) => ({
        start_time: s.start,
        end_time: s.end,
        type: 0, // Default type for now
        params: s.params || {},
      })),
    }

    const response = await axios.post('http://127.0.0.1:8000/api/compile', payload)
    alert(`Export successful! File saved to: ${response.data.file_path}`)
  } catch (error) {
    console.error('Export failed:', error)
    alert('Export failed.')
  }
}
</script>

<style scoped>
/* Removed @apply to fix Tailwind v4 integration */
</style>

