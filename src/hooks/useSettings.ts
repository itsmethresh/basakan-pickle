import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
export const useSettings = () => useQuery({
  queryKey: ['settings'],
  queryFn: async () => {
    const { data, error } = await supabase.from('settings').select('*').eq('id', 1).single()
    if (error) throw error
    return data
  }
})
