import { createClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';

export const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
};

const getOfflineQueue = () => JSON.parse(localStorage.getItem('hort_offline_queue') || '[]');
const saveOfflineQueue = (queue) => localStorage.setItem('hort_offline_queue', JSON.stringify(queue));

export const dbService = {
  // 1. AUTHENTICATION
  async login(email, password) {
    if (!supabase) throw new Error('Supabase is not configured. Check your VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    const { data: profile, error: profError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();

    if (profError) throw profError;
    return { user: data.user, profile };
  },

  async signup(email, password, fullName, role = 'employee') {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, role } }
    });
    if (error) throw error;
    return data;
  },

  async logout() {
    await supabase.auth.signOut();
  },

  async sendPasswordResetEmail(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) throw error;
  },

  async getCurrentUser() {
    if (!supabase) return null;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    return { user, profile };
  },

  // 2. EMPLOYEE MANAGEMENT
  async createEmployee(email, password, fullName, role = 'employee', createdBy = null) {
    // persistSession: false keeps this client's session in memory only,
    // so it never touches localStorage and cannot disturb the admin's session.
    const tempClient = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
    );

    const { data, error } = await tempClient.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, role } }
    });

    if (error) throw error;
    if (!data.user) throw new Error('Account creation failed. The email may already be registered.');

    // Record which admin created this account
    if (createdBy) {
      await supabase
        .from('profiles')
        .update({ created_by: createdBy })
        .eq('id', data.user.id);
    }

    return data.user;
  },

  async getEmployees() {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('full_name', { ascending: true });
    if (error) throw error;
    return data;
  },

  async updateEmployee(id, fullName, role) {
    const { error } = await supabase.rpc('admin_update_employee', {
      p_employee_id: id,
      p_full_name: fullName,
      p_role: role
    });
    if (error) throw error;
  },

  async deleteEmployee(id) {
    const { error } = await supabase.rpc('admin_delete_employee', { p_employee_id: id });
    if (error) throw error;
  },

  async getEmployeeSites(employeeId) {
    const { data, error } = await supabase
      .from('employee_site_assignments')
      .select('client_id, clients(id, name, address)')
      .eq('employee_id', employeeId);
    if (error) throw error;
    return data.map(d => d.clients);
  },

  async assignSite(employeeId, clientId) {
    const { error } = await supabase
      .from('employee_site_assignments')
      .insert({ employee_id: employeeId, client_id: clientId });
    if (error) throw error;
  },

  async removeSiteAssignment(employeeId, clientId) {
    const { error } = await supabase
      .from('employee_site_assignments')
      .delete()
      .eq('employee_id', employeeId)
      .eq('client_id', clientId);
    if (error) throw error;
  },

  // 3. CLIENT MANAGEMENT
  async getAssignedClients(employeeId) {
    if (navigator.onLine) {
      try {
        const { data, error } = await supabase
          .from('employee_site_assignments')
          .select('clients(id, name, address, latitude, longitude)')
          .eq('employee_id', employeeId);
        if (error) throw error;
        const clients = data.map(d => d.clients).filter(Boolean);

        // Cache under employee-specific key for offline fallback
        localStorage.setItem(`hort_assigned_clients_${employeeId}`, JSON.stringify(clients));

        // Also merge into hort_clients so checkIn can find them by ID
        const existing = JSON.parse(localStorage.getItem('hort_clients') || '[]');
        const merged = [...existing];
        clients.forEach(c => {
          const idx = merged.findIndex(e => e.id === c.id);
          if (idx === -1) merged.push(c);
          else merged[idx] = c;
        });
        localStorage.setItem('hort_clients', JSON.stringify(merged));

        return clients;
      } catch (e) {
        console.warn('Network failed. Loading cached assigned clients.', e);
        return JSON.parse(localStorage.getItem(`hort_assigned_clients_${employeeId}`) || '[]');
      }
    }
    return JSON.parse(localStorage.getItem(`hort_assigned_clients_${employeeId}`) || '[]');
  },

  async getClients() {
    if (navigator.onLine) {
      try {
        const { data, error } = await supabase.from('clients').select('*');
        if (error) throw error;
        const parsed = data.map((c) => ({
          id: c.id,
          name: c.name,
          address: c.address,
          latitude: c.latitude || 0,
          longitude: c.longitude || 0
        }));
        localStorage.setItem('hort_clients', JSON.stringify(parsed));
        return parsed;
      } catch (e) {
        console.warn('Network failed. Loading cached clients list.', e);
        return JSON.parse(localStorage.getItem('hort_clients') || '[]');
      }
    }
    return JSON.parse(localStorage.getItem('hort_clients') || '[]');
  },

  async addClient(name, address, latitude, longitude) {
    const point = `POINT(${longitude} ${latitude})`;
    const { data, error } = await supabase
      .from('clients')
      .insert([{ name, address, location: point, latitude, longitude }])
      .select();
    if (error) throw error;
    return data[0];
  },

  async deleteClient(id) {
    const { error } = await supabase.from('clients').delete().eq('id', id);
    if (error) throw error;
  },

  async updateClient(id, name, address, latitude, longitude) {
    const point = `POINT(${longitude} ${latitude})`;
    const { data, error } = await supabase
      .from('clients')
      .update({ name, address, location: point, latitude, longitude })
      .eq('id', id)
      .select();
    if (error) throw error;
    return data[0];
  },

  // 4. ATTENDANCE SESSIONS & GEOFENCING WITH OFFLINE QUEUEING
  async checkIn(clientId, latitude, longitude, maxDistanceMeters = 100) {
    const clients = JSON.parse(localStorage.getItem('hort_clients') || '[]');
    const client = clients.find((c) => c.id === clientId);
    if (!client) throw new Error('Client location not found.');

    const distance = calculateDistance(latitude, longitude, client.latitude, client.longitude);
    if (distance > maxDistanceMeters) {
      throw new Error(
        `Geofence verification failed. You are currently ${Math.round(distance)}m away. You must be within ${maxDistanceMeters}m of ${client.name} to check in.`
      );
    }

    const currentUser = await this.getCurrentUser();
    const tempSessionId = `sess-temp-${Date.now()}`;

    const sessions = JSON.parse(localStorage.getItem('hort_sessions') || '[]');
    sessions.forEach(s => {
      if (s.employee_id === currentUser.profile.id && !s.check_out_time) {
        s.check_out_time = new Date().toISOString();
        s.check_out_latitude = latitude;
        s.check_out_longitude = longitude;
      }
    });

    const localSession = {
      id: tempSessionId,
      employee_id: currentUser.profile.id,
      employee_name: currentUser.profile.full_name,
      client_id: clientId,
      client_name: client.name,
      check_in_time: new Date().toISOString(),
      check_in_latitude: latitude,
      check_in_longitude: longitude,
      check_out_time: null,
      check_out_latitude: null,
      check_out_longitude: null
    };

    sessions.push(localSession);
    localStorage.setItem('hort_sessions', JSON.stringify(sessions));

    if (navigator.onLine) {
      try {
        const { data, error } = await supabase.rpc('check_in_employee', {
          p_client_id: clientId,
          p_latitude: latitude,
          p_longitude: longitude,
          p_max_distance: maxDistanceMeters
        });
        if (error) throw error;

        const idx = sessions.findIndex(s => s.id === tempSessionId);
        if (idx !== -1) {
          sessions[idx].id = data.id;
          localStorage.setItem('hort_sessions', JSON.stringify(sessions));
        }
        return data;
      } catch (err) {
        console.warn('Supabase check-in failed, queueing request offline...', err);
      }
    }

    const queue = getOfflineQueue();
    queue.push({
      id: `q-${Date.now()}`,
      action: 'checkIn',
      tempSessionId,
      params: { clientId, latitude, longitude, maxDistanceMeters }
    });
    saveOfflineQueue(queue);

    return localSession;
  },

  async checkOut(sessionId, latitude, longitude) {
    const sessions = JSON.parse(localStorage.getItem('hort_sessions') || '[]');
    const idx = sessions.findIndex(s => s.id === sessionId);
    if (idx !== -1) {
      sessions[idx].check_out_time = new Date().toISOString();
      sessions[idx].check_out_latitude = latitude;
      sessions[idx].check_out_longitude = longitude;
      localStorage.setItem('hort_sessions', JSON.stringify(sessions));
    }

    if (navigator.onLine && !sessionId.startsWith('sess-temp-')) {
      try {
        const point = `POINT(${longitude} ${latitude})`;
        const { data, error } = await supabase
          .from('attendance_sessions')
          .update({
            check_out_time: new Date().toISOString(),
            check_out_location: point,
            check_out_latitude: latitude,
            check_out_longitude: longitude
          })
          .eq('id', sessionId)
          .select();
        if (error) throw error;
        return data[0];
      } catch (e) {
        console.warn('Supabase check-out failed, queueing offline...', e);
      }
    }

    const queue = getOfflineQueue();
    queue.push({
      id: `q-${Date.now()}`,
      action: 'checkOut',
      tempSessionId: sessionId.startsWith('sess-temp-') ? sessionId : null,
      sessionId: sessionId.startsWith('sess-temp-') ? null : sessionId,
      params: { latitude, longitude }
    });
    saveOfflineQueue(queue);

    return idx !== -1 ? sessions[idx] : null;
  },

  async getActiveSession(employeeId) {
    const sessions = JSON.parse(localStorage.getItem('hort_sessions') || '[]');
    const active = sessions.find((s) => s.employee_id === employeeId && !s.check_out_time);

    if (navigator.onLine) {
      try {
        const { data, error } = await supabase
          .from('attendance_sessions')
          .select('*')
          .eq('employee_id', employeeId)
          .is('check_out_time', null)
          .order('check_in_time', { ascending: false })
          .limit(1);

        if (error) throw error;

        if (data[0] && (!active || active.id !== data[0].id)) {
          const localSessions = sessions.filter(s => s.id !== active?.id);
          localSessions.push({
            id: data[0].id,
            employee_id: employeeId,
            employee_name: active?.employee_name || 'Field Representative',
            client_id: data[0].client_id,
            client_name: active?.client_name || 'Client Site',
            check_in_time: data[0].check_in_time,
            check_in_latitude: active?.check_in_latitude || 0,
            check_in_longitude: active?.check_in_longitude || 0,
            check_out_time: null
          });
          localStorage.setItem('hort_sessions', JSON.stringify(localSessions));
        }
        return data[0] || active || null;
      } catch (e) {
        console.warn('Network failed. Fallback to cached active session.');
      }
    }
    return active || null;
  },

  // 4. HOURLY LOCATION LOGS WITH OFFLINE QUEUEING
  async logLocation(sessionId, latitude, longitude, batteryLevel = null) {
    const currentUser = await this.getCurrentUser();

    const logs = JSON.parse(localStorage.getItem('hort_location_logs') || '[]');
    const localLog = {
      id: `log-${Date.now()}`,
      session_id: sessionId,
      employee_id: currentUser.profile.id,
      employee_name: currentUser.profile.full_name,
      timestamp: new Date().toISOString(),
      latitude,
      longitude,
      battery_level: batteryLevel ? Math.round(batteryLevel * 100) : null
    };
    logs.push(localLog);
    localStorage.setItem('hort_location_logs', JSON.stringify(logs));

    if (navigator.onLine && !sessionId.startsWith('sess-temp-')) {
      try {
        const point = `POINT(${longitude} ${latitude})`;
        const { data, error } = await supabase
          .from('hourly_location_logs')
          .insert([{ session_id: sessionId, employee_id: currentUser.profile.id, location: point, battery_level: batteryLevel }]);
        if (error) throw error;
        return data;
      } catch (e) {
        console.warn('Location ping failed. Queueing offline...', e);
      }
    }

    const queue = getOfflineQueue();
    queue.push({
      id: `q-${Date.now()}`,
      action: 'logLocation',
      tempSessionId: sessionId.startsWith('sess-temp-') ? sessionId : null,
      sessionId: sessionId.startsWith('sess-temp-') ? null : sessionId,
      params: { latitude, longitude, batteryLevel, timestamp: localLog.timestamp }
    });
    saveOfflineQueue(queue);

    return localLog;
  },

  async getLocationLogs(sessionId) {
    if (navigator.onLine && !sessionId.startsWith('sess-temp-')) {
      try {
        const { data, error } = await supabase
          .from('hourly_location_logs')
          .select('*')
          .eq('session_id', sessionId)
          .order('timestamp', { ascending: true });
        if (error) throw error;
        return data.map(d => ({
          id: d.id,
          session_id: d.session_id,
          employee_id: d.employee_id,
          timestamp: d.timestamp,
          latitude: d.latitude || 0,
          longitude: d.longitude || 0,
          battery_level: Math.round(d.battery_level * 100)
        }));
      } catch (e) {
        console.warn('Network error loading location pings. Loading from cache.');
      }
    }
    const logs = JSON.parse(localStorage.getItem('hort_location_logs') || '[]');
    return logs.filter((l) => l.session_id === sessionId);
  },

  // 5. OFFLINE SYNCHRONIZATION PLAYBACK
  async syncOfflineQueue() {
    if (!navigator.onLine) return { syncedCount: 0 };

    const queue = getOfflineQueue();
    if (queue.length === 0) return { syncedCount: 0 };

    console.log(`Starting synchronization of ${queue.length} offline operations...`);

    const sessionMapping = {};
    const unsyncedItems = [];
    let syncedCount = 0;

    for (const item of queue) {
      try {
        if (item.action === 'checkIn') {
          const { clientId, latitude, longitude, maxDistanceMeters } = item.params;
          const { data, error } = await supabase.rpc('check_in_employee', {
            p_client_id: clientId,
            p_latitude: latitude,
            p_longitude: longitude,
            p_max_distance: maxDistanceMeters
          });
          if (error) throw error;

          sessionMapping[item.tempSessionId] = data.id;
          syncedCount++;

          const sessions = JSON.parse(localStorage.getItem('hort_sessions') || '[]');
          const idx = sessions.findIndex(s => s.id === item.tempSessionId);
          if (idx !== -1) {
            sessions[idx].id = data.id;
            localStorage.setItem('hort_sessions', JSON.stringify(sessions));
          }
          const logs = JSON.parse(localStorage.getItem('hort_location_logs') || '[]');
          logs.forEach(l => { if (l.session_id === item.tempSessionId) l.session_id = data.id; });
          localStorage.setItem('hort_location_logs', JSON.stringify(logs));

        } else if (item.action === 'logLocation') {
          const realSessionId = item.sessionId || sessionMapping[item.tempSessionId];
          if (!realSessionId) throw new Error(`Session ID mapping missing for ${item.tempSessionId}`);

          const { latitude, longitude, batteryLevel, timestamp } = item.params;
          const point = `POINT(${longitude} ${latitude})`;
          const { error } = await supabase
            .from('hourly_location_logs')
            .insert([{
              session_id: realSessionId,
              employee_id: (await this.getCurrentUser()).profile.id,
              location: point,
              battery_level: batteryLevel,
              timestamp
            }]);
          if (error) throw error;
          syncedCount++;

        } else if (item.action === 'checkOut') {
          const realSessionId = item.sessionId || sessionMapping[item.tempSessionId];
          if (!realSessionId) throw new Error(`Session ID mapping missing for checkout ${item.tempSessionId}`);

          const { latitude, longitude } = item.params;
          const point = `POINT(${longitude} ${latitude})`;
          const { error } = await supabase
            .from('attendance_sessions')
            .update({ check_out_time: new Date().toISOString(), check_out_location: point })
            .eq('id', realSessionId);
          if (error) throw error;
          syncedCount++;
        }
      } catch (err) {
        console.error(`Offline sync failed for item ${item.id}:`, err);
        unsyncedItems.push(item);
      }
    }

    saveOfflineQueue(unsyncedItems);
    console.log(`Sync completed. Successfully played back ${syncedCount} requests.`);
    return { syncedCount };
  },

  getQueueLength() {
    return getOfflineQueue().length;
  },

  // 6. PHOTO UPLOAD
  async uploadCheckInPhoto(blob, employeeId, sessionId) {
    const path = `${employeeId}/${sessionId}.jpg`;
    const { error } = await supabase.storage
      .from('checkin-photos')
      .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from('checkin-photos').getPublicUrl(path);
    return data.publicUrl;
  },

  async savePhotoUrl(sessionId, photoUrl) {
    const { error } = await supabase
      .from('attendance_sessions')
      .update({ check_in_photo_url: photoUrl })
      .eq('id', sessionId);
    if (error) throw error;
  },

  async uploadCheckOutPhoto(blob, employeeId, sessionId) {
    const path = `${employeeId}/${sessionId}_out.jpg`;
    const { error } = await supabase.storage
      .from('checkin-photos')
      .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from('checkin-photos').getPublicUrl(path);
    return data.publicUrl;
  },

  async saveCheckOutPhotoUrl(sessionId, photoUrl) {
    const { error } = await supabase
      .from('attendance_sessions')
      .update({ check_out_photo_url: photoUrl })
      .eq('id', sessionId);
    if (error) throw error;
  },

  // 7. ADMIN REPORTING
  async getActiveCheckIns() {
    const { data, error } = await supabase
      .from('attendance_sessions')
      .select('*, profiles(full_name, role), clients(name, address)')
      .is('check_out_time', null)
      .order('check_in_time', { ascending: false });
    if (error) throw error;
    return data.map(d => ({
      id: d.id,
      employee_id: d.employee_id,
      employee_name: d.profiles?.full_name || 'Unknown',
      employee_role: d.profiles?.role || 'employee',
      client_id: d.client_id,
      client_name: d.clients?.name || 'Unknown Site',
      client_address: d.clients?.address || '',
      check_in_time: d.check_in_time,
      check_in_latitude: d.check_in_latitude,
      check_in_longitude: d.check_in_longitude,
      check_in_photo_url: d.check_in_photo_url || null,
    }));
  },

  async getAttendanceLogs() {
    if (navigator.onLine) {
      try {
        const { data, error } = await supabase
          .from('attendance_sessions')
          .select('*, profiles(full_name), clients(name)')
          .order('check_in_time', { ascending: false });
        if (error) throw error;

        const mapped = data.map(d => ({
          id: d.id,
          employee_id: d.employee_id,
          employee_name: d.profiles?.full_name || 'Field Representative',
          client_id: d.client_id,
          client_name: d.clients?.name || 'Client Location',
          check_in_time: d.check_in_time,
          check_in_latitude: d.check_in_latitude || 0,
          check_in_longitude: d.check_in_longitude || 0,
          check_out_time: d.check_out_time,
          check_out_latitude: d.check_out_latitude || 0,
          check_out_longitude: d.check_out_longitude || 0,
          check_in_photo_url: d.check_in_photo_url || null,
          check_out_photo_url: d.check_out_photo_url || null
        }));
        localStorage.setItem('hort_sessions', JSON.stringify(mapped));
        return mapped;
      } catch (e) {
        console.warn('Network error fetching attendance logs. Loading cached reports.');
      }
    }
    const sessions = JSON.parse(localStorage.getItem('hort_sessions') || '[]');
    return [...sessions].sort((a, b) => new Date(b.check_in_time) - new Date(a.check_in_time));
  }
};
