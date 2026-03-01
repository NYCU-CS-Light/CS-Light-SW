<script setup>
import { ref } from 'vue'
import TopBar from './components/TopBar.vue'
import TimelineEditor from './components/TimelineEditor.vue'
import ParameterPanel from './components/ParameterPanel.vue'

const timelineEditorRef = ref(null)

const handlePlayPause = () => {
  if (timelineEditorRef.value) {
    timelineEditorRef.value.togglePlay()
  }
}
</script>

<template>
  <div class="h-screen w-screen flex flex-col overflow-hidden">
    <!-- Top Bar -->
    <div class="h-16 flex-none z-10">
      <TopBar @playPause="handlePlayPause" />
    </div>

    <!-- Main Content -->
    <div class="flex-1 flex overflow-hidden">
      <!-- Editors Area -->
      <div class="flex-1 flex flex-col bg-gray-900 relative">
        <!-- Timeline takes available space -->
        <div class="flex-1 p-4 overflow-y-auto">
          <TimelineEditor ref="timelineEditorRef" />
        </div>
      </div>

      <!-- Right Panel -->
      <div class="w-80 flex-none h-full border-l bg-white">
        <ParameterPanel />
      </div>
    </div>
  </div>
</template>

<style>
body {
  margin: 0;
  padding: 0;
  overflow: hidden;
}
</style>
