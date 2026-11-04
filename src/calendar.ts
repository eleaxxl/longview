// One calendar interface for every platform: the device's calendars on iOS/Android (Google accounts
// synced by the system), Google Calendar directly on the web.
import { Platform } from 'react-native';

import * as device from './deviceCalendar';
import * as google from './googleCalendar';

const web = Platform.OS === 'web';
const api = web ? google : device;

/** The web version signs in to Google from a button; the apps ask the system for access. */
export const needsSignIn = web;
export const calendarSupported = web ? google.googleConfigured : device.deviceCalendarSupported;

/** Asks for access on the device; on the web only picks up an earlier sign-in, never a popup. */
export const requestAccess = (): Promise<boolean> => (web ? Promise.resolve(google.hasSession()) : device.requestAccess());
export const connect = google.connect;
export const disconnect = google.disconnect;
export const isSignInNeeded = google.isSignInNeeded;

export const { loadCalendars, loadEvents, createEvent, updateEvent, deleteEvent } = api;
