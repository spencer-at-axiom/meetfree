"use client";

import { useMeetings } from "@/contexts/MeetingsContext";
import { useRouter } from "next/navigation"




export const useNavigation = (meetingId: string, meetingTitle: string) => {
    const router = useRouter();
    const { setCurrentMeeting } = useMeetings();

    const handleNavigation = () => {
        setCurrentMeeting({ id: meetingId, title: meetingTitle });
        router.push(`/meeting-details?id=${meetingId}`);
    };

    return handleNavigation;
};

