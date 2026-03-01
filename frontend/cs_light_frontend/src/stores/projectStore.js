import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useProjectStore = defineStore('project', () => {
  // Audio State
  const audioUrl = ref(null)
  const audioBuffer = ref(null) // Available if we need raw data
  const duration = ref(0)
  const fileName = ref('')

  // Analysis Data
  const beats = ref([]) // Array of timestamps

  // ISA Segments
  // Structure: { id, start, end, color: '#RRGGBB', params: {} }
  const segments = ref([])
  const selectedSegmentId = ref(null)

  // Actions
  function setAudio(url, file) {
    audioUrl.value = url
    fileName.value = file.name
  }

  function setBeats(newBeats) {
    beats.value = newBeats
  }

  function addSegment(segment) {
    segments.value.push(segment)
    selectedSegmentId.value = segment.id
  }

  function updateSegment(id, newParams) {
    const index = segments.value.findIndex((s) => s.id === id)
    if (index !== -1) {
      segments.value[index] = { ...segments.value[index], ...newParams }
    }
  }

  function removeSegment(id) {
    segments.value = segments.value.filter((s) => s.id !== id)
    if (selectedSegmentId.value === id) {
      selectedSegmentId.value = null
    }
  }

  function selectSegment(id) {
    selectedSegmentId.value = id
  }

  function getSegmentById(id) {
    return segments.value.find((s) => s.id === id)
  }

  return {
    audioUrl,
    fileName,
    duration,
    beats,
    segments,
    selectedSegmentId,
    setAudio,
    setBeats,
    addSegment,
    updateSegment,
    removeSegment,
    selectSegment,
    getSegmentById,
  }
})
