export const requestNotificationPermission = async () => {
  if ('Notification' in window) {
    await Notification.requestPermission();
  }
};

export const sendNotification = (title: string, body: string) => {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/favicon.ico' });
  }
};
