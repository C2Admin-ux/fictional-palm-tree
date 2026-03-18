export default function PropertyPage({ params }: { params: { id: string } }) {
  return <div className="p-6"><h1 className="text-xl font-semibold">Property {params.id}</h1><p className="text-sm text-slate-500 mt-1">Coming soon.</p></div>
}
