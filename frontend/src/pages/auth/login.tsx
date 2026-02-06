import { useState } from "react";
import { useLocation } from "wouter";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { User, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [_, setLocation] = useLocation();
  const setCurrentUser = useStore(state => state.setCurrentUser);
  const { toast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username || !password) {
      toast({
        title: "Error",
        description: "Please enter username and password",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);

    try {
      const { user } = await api.login(username, password);
      
      // Update Zustand store with logged in user
      setCurrentUser({
        id: user.id,
        username: user.username,
        role: user.role,
        balance: parseFloat(user.balance),
        exposure: parseFloat(user.exposure),
        currency: user.currency
      });

      toast({
        title: "Welcome back!",
        description: `Logged in as ${user.role.toLowerCase()}`,
        className: "bg-green-600 text-white border-none"
      });

      // Redirect based on role - Admins and Super Admins go to admin panel
      const isAdminRole = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
      setLocation(isAdminRole ? '/admin' : '/');
    } catch (error: any) {
      toast({
        title: "Login Failed",
        description: error.message || "Invalid credentials",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#F7F5EF] text-[#1F2733] relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none" />

      <div className="relative z-10 w-full max-w-md px-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight text-[#0B8A5F]">CricFun Exchange</h1>
          <p className="text-sm text-[#7A7F87] mt-1">Play for Fun only</p>
        </div>

        <Card className="border-[#E5E0D6] bg-[#FDFBF6] shadow-md">
          <CardHeader>
            <CardTitle className="text-[#1F2733]">Welcome Back</CardTitle>
            <CardDescription className="text-[#7A7F87]">Login to your account</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-[#1F2733]" data-testid="label-username">Username</label>
                <div className="relative">
                  <User className="absolute left-3 top-2.5 h-4 w-4 text-[#7A7F87]" />
                  <Input 
                    data-testid="input-username"
                    placeholder="Enter username" 
                    className="pl-9 bg-white border-[#E5E0D6] text-[#1F2733] focus:border-[#0B8A5F] focus:ring-[#0B8A5F]"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={isLoading}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-[#1F2733]" data-testid="label-password">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-[#7A7F87]" />
                  <Input 
                    data-testid="input-password"
                    type="password"
                    placeholder="Enter password" 
                    className="pl-9 bg-white border-[#E5E0D6] text-[#1F2733] focus:border-[#0B8A5F] focus:ring-[#0B8A5F]"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                  />
                </div>
              </div>

              <Button 
                data-testid="button-login"
                type="submit" 
                className="w-full font-bold bg-[#0B8A5F] hover:bg-[#0A7A55] text-white shadow-md" 
                disabled={isLoading}
              >
                {isLoading ? "Logging in..." : "Login"}
              </Button>

            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
