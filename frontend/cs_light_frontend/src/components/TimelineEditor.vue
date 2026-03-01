<template>
  <div class="timeline-container w-full h-[300px] border relative bg-black" ref="container">
    <div id="waveform" ref="waveformRef"></div>
    <div id="timeline" ref="timelineRef"></div>
  </div>
</template>

<script setup>
import { onMounted, ref, watch, onUnmounted } from 'vue'
import WaveSurfer from 'wavesurfer.js'
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'
import ZoomPlugin from 'wavesurfer.js/dist/plugins/zoom.esm.js'
import { useProjectStore } from '../stores/projectStore'

const container = ref(null)
const waveformRef = ref(null)
const timelineRef = ref(null)
const wavesurfer = ref(null)
const wsRegions = ref(null)

const projectStore = useProjectStore()
const emit = defineEmits(['ready'])

// Initialize WaveSurfer
const initWaveSurfer = () => {

  if (wavesurfer.value) {
    wavesurfer.value.destroy()
  }

  // Create Regions Plugin
  wsRegions.value = RegionsPlugin.create()

  wavesurfer.value = WaveSurfer.create({
    container: waveformRef.value,
    waveColor: '#4F4A85',
    progressColor: '#383351',
    cursorColor: '#ff5722',
    height: 200, 
    minPxPerSec: 50, // Default zoom
    plugins: [
      TimelinePlugin.create({
        container: timelineRef.value,
      }),
      wsRegions.value,
      ZoomPlugin.create({ scale: 0.5 })
    ],
  })

  // Add zoom wheel listener manually
  if (wavesurfer.value) {

      wavesurfer.value.on('decode', () => {
          const wrapper = waveformRef.value
          if (wrapper) {
            wrapper.addEventListener('wheel', (e) => {
                if (e.ctrlKey || e.metaKey) {
                   e.preventDefault()
                   const ZOOM_SPEED = 2
                   const newMinPxPerSec = Number(wavesurfer.value.options.minPxPerSec) + e.deltaY * -ZOOM_SPEED * 0.1
                   wavesurfer.value.zoom(Math.max(10, newMinPxPerSec))
                   // updateBeatsDebounced() // triggered by 'zoom' event usually
                }
            })
          }
      })
  }

  // Regions Events
  wsRegions.value.on('region-created', (region) => {
    // Only add to store if it doesn't have 'beat-' prefix
    if (region.id.startsWith('beat-')) return

    console.log('region-created', region)
    const newSegment = {
      id: region.id,
      start: region.start,
      end: region.end,
      color: region.color,
      params: { r: 255, g: 255, b: 255, speed: 100 }, // Defaults
    }
    projectStore.addSegment(newSegment)
  })

  wsRegions.value.on('region-updated', (region) => {
    // console.log('region-updated', region)
    // Update store
    projectStore.updateSegment(region.id, {
      start: region.start,
      end: region.end,
    })
  })

  wsRegions.value.on('region-clicked', (region, e) => {
    e.stopPropagation() // prevent seeking
    projectStore.selectSegment(region.id)
    // Highlight region visually? handled by plugin mostly
  })
}

// Watch for audio URL changes
watch(
  () => projectStore.audioUrl,
  (newUrl) => {
    if (newUrl && wavesurfer.value) {
      wavesurfer.value.load(newUrl)
    }
  },
)

// Watch for store segments changes
watch(
  () => projectStore.segments,
  (segments) => {
    // Basic sync
  },
  { deep: true },
)

const togglePlay = () => {
    if(wavesurfer.value) {
        wavesurfer.value.playPause()
    }
}

// Expose methods to parent
defineExpose({
  togglePlay,
})


onMounted(() => {
  initWaveSurfer()
})

onUnmounted(() => {
  if (wavesurfer.value) wavesurfer.value.destroy()
})
</script>

<style scoped>
/* WaveSurfer styles handles mostly by JS, but container needs layout */
</style>
