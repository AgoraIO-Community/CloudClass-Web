import { useCallback } from 'react';
import { useStore } from './ui-store';

export const useExtensionCabinets = () => {
  const { widgetUIStore, classroomStore } = useStore();

  const openExtensionCabinet = useCallback((id: string, remote = true) => {
    const nextZIndex =
      classroomStore.widgetStore.widgetController?.zIndexController.incrementZIndex();

    const trackProps = { position: { xaxis: 0.5, yaxis: 0.5 }, zIndex: nextZIndex };
    widgetUIStore.createWidget(id, {
      trackProperties: trackProps,
      userProperties: {},
      properties: {},
    });

    if (remote) {
      classroomStore.widgetStore.widgetController?.setWidegtActive(id, trackProps);
    }
  }, []);

  const isInstalled = useCallback((id: string) => {
    const names = widgetUIStore.registeredWidgetNames;
    return names.includes(id);
  }, []);

  return {
    openExtensionCabinet,
    isInstalled,
  };
};
