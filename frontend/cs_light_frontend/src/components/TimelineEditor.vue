<template>
  <div class="timeline-container w-full h-[300px] border relative bg-black overflow-hidden" ref="container">
    
    <div class="absolute inset-0 flex flex-col z-10">
      <div id="waveform" ref="waveformRef" class="flex-1 w-full relative"></div>
      <div id="timeline" ref="timelineRef" class="w-full"></div>
    </div>
    
    <div class="absolute inset-0 z-50 pointer-events-none">
      
      <div class="absolute top-2 right-2 flex gap-2 pointer-events-auto">
        <button 
          @click.stop="zoomIn" 
          class="w-8 h-8 flex items-center justify-center bg-gray-800 hover:bg-gray-700 text-white rounded-full shadow-lg border border-gray-600 transition-colors"
          title="Zoom In"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        </button>
        <button 
          @click.stop="zoomOut" 
          class="w-8 h-8 flex items-center justify-center bg-gray-800 hover:bg-gray-700 text-white rounded-full shadow-lg border border-gray-600 transition-colors"
          title="Zoom Out"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        </button>
      </div>
      
    </div>
  </div>
</template>

<script setup>
// 引入 shallowRef
import { onMounted, ref, shallowRef, watch, onUnmounted } from 'vue'
import WaveSurfer from 'wavesurfer.js'
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'
// ZoomPlugin 不是必須的，v7 內建 zoom 方法，若無使用可考慮移除 import
// import ZoomPlugin from 'wavesurfer.js/dist/plugins/zoom.esm.js' 
import { useProjectStore } from '../stores/projectStore'

const container = ref(null)
const waveformRef = ref(null)
const timelineRef = ref(null)

// 【關鍵修正】：使用 shallowRef 避免 Vue 遞迴 proxy 造成的效能崩潰與閃爍
const wavesurfer = shallowRef(null)
const wsRegions = shallowRef(null)

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
    minPxPerSec: 50, 
    autoScroll: true,
    autoCenter: false, 
    fillParent: true, 
    plugins: [
      TimelinePlugin.create({
        container: timelineRef.value,
      }),
      wsRegions.value,
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
          }
        })
      }
    })

    // Regions Events
    wsRegions.value.on('region-created', (region) => {
      if (region.id.startsWith('beat-')) return

      const newSegment = {
        id: region.id,
        start: region.start,
        end: region.end,
        color: region.color,
        params: { r: 255, g: 255, b: 255, speed: 100 }, 
      }
      projectStore.addSegment(newSegment)
    })

    wsRegions.value.on('region-updated', (region) => {
      projectStore.updateSegment(region.id, {
        start: region.start,
        end: region.end,
      })
    })

    wsRegions.value.on('region-clicked', (region, e) => {
      e.stopPropagation() 
      projectStore.selectSegment(region.id)
    })
  }
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

const zoomIn = () => {
  if (!wavesurfer.value) return
  const currentZoom = Number(wavesurfer.value.options.minPxPerSec) || 50
  const newZoom = currentZoom * 1.2
  wavesurfer.value.zoom(newZoom)
}

const zoomOut = () => {
  if (!wavesurfer.value) return
  const currentZoom = Number(wavesurfer.value.options.minPxPerSec) || 50
  const newZoom = Math.max(10, currentZoom * 0.8)
  wavesurfer.value.zoom(newZoom)
}

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
