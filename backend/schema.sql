-- Enable the PostGIS extension to handle geographical data (coordinates, distances)
create extension if not exists postgis;

-- 1. Profiles Table (Employee / Admin metadata)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text not null,
  role text check (role in ('admin', 'employee')) default 'employee',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on Profiles
alter table public.profiles enable row level security;

-- Profiles Policies
create policy "Users can view their own profile." on public.profiles
  for select using (auth.uid() = id);

create policy "Users can update their own profile." on public.profiles
  for update using (auth.uid() = id);

create policy "Admins can view all profiles." on public.profiles
  for select using (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  );

create policy "Admins can update all profiles." on public.profiles
  for all using (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  );

-- Automatically create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', 'New Employee'),
    coalesce(new.raw_user_meta_data->>'role', 'employee')
  );
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- 2. Clients Table (Service locations)
create table public.clients (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  address text,
  location geography(point, 4326) not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on Clients
alter table public.clients enable row level security;

-- Clients Policies
create policy "Authenticated users can view clients." on public.clients
  for select using (auth.role() = 'authenticated');

create policy "Admins can manage clients." on public.clients
  for all using (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  );


-- 3. Attendance Sessions Table (Check-in/Check-out)
create table public.attendance_sessions (
  id uuid default gen_random_uuid() primary key,
  employee_id uuid references public.profiles(id) on delete cascade not null,
  client_id uuid references public.clients(id) on delete cascade not null,
  check_in_time timestamp with time zone default timezone('utc'::text, now()) not null,
  check_in_location geography(point, 4326) not null,
  check_out_time timestamp with time zone,
  check_out_location geography(point, 4326),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on Attendance Sessions
alter table public.attendance_sessions enable row level security;

-- Attendance Sessions Policies
create policy "Employees can view their own sessions." on public.attendance_sessions
  for select using (auth.uid() = employee_id);

create policy "Employees can create their own sessions." on public.attendance_sessions
  for insert with check (auth.uid() = employee_id);

create policy "Employees can update their own sessions (for check-out)." on public.attendance_sessions
  for update using (auth.uid() = employee_id);

create policy "Admins can view and manage all sessions." on public.attendance_sessions
  for all using (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  );


-- 4. Hourly Location Logs (Background tracking during shift)
create table public.hourly_location_logs (
  id uuid default gen_random_uuid() primary key,
  session_id uuid references public.attendance_sessions(id) on delete cascade not null,
  employee_id uuid references public.profiles(id) on delete cascade not null,
  timestamp timestamp with time zone default timezone('utc'::text, now()) not null,
  location geography(point, 4326) not null,
  battery_level float
);

-- Enable RLS on Location Logs
alter table public.hourly_location_logs enable row level security;

-- Location Logs Policies
create policy "Employees can view their own location logs." on public.hourly_location_logs
  for select using (auth.uid() = employee_id);

create policy "Employees can log their location." on public.hourly_location_logs
  for insert with check (auth.uid() = employee_id);

create policy "Admins can view all location logs." on public.hourly_location_logs
  for select using (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  );


-- 5. Geofencing Verification Database Functions
-- This function checks if a set of coordinates is within a specified distance (meters) of a client
create or replace function public.is_within_geofence(
  client_id uuid,
  latitude double precision,
  longitude double precision,
  max_distance_meters double precision default 100.0
)
returns boolean as $$
declare
  client_loc geography(point, 4326);
  distance double precision;
begin
  -- Fetch client location
  select location into client_loc from public.clients where id = client_id;
  
  if client_loc is null then
    raise exception 'Client not found';
  end if;

  -- ST_Distance calculates distance in meters on the spheroid (WGS 84 / SRID 4326)
  distance := ST_Distance(client_loc, ST_SetSRID(ST_Point(longitude, latitude), 4326)::geography);
  
  return distance <= max_distance_meters;
end;
$$ language plpgsql security definer;


-- Secure Check-in RPC (Remote Procedure Call)
-- This encapsulates the geofencing check inside a database transaction to prevent client-side bypass.
create or replace function public.check_in_employee(
  p_client_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_max_distance double precision default 100.0
)
returns public.attendance_sessions as $$
declare
  v_is_within boolean;
  v_session public.attendance_sessions;
  v_point geography(point, 4326);
begin
  -- Check if worker is within geofence
  v_is_within := public.is_within_geofence(p_client_id, p_latitude, p_longitude, p_max_distance);
  
  if not v_is_within then
    raise exception 'Geofence verification failed. You must be within % meters of the client site to check in.', p_max_distance;
  end if;

  -- Create check-in point geography
  v_point := ST_SetSRID(ST_Point(p_longitude, p_latitude), 4326)::geography;

  -- Insert session
  insert into public.attendance_sessions (employee_id, client_id, check_in_time, check_in_location)
  values (auth.uid(), p_client_id, now(), v_point)
  returning * into v_session;

  return v_session;
end;
$$ language plpgsql security definer;
